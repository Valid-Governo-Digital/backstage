/*
 * Copyright 2024 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  DEFAULT_NAMESPACE,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import { NotAllowedError, ServiceUnavailableError } from '@backstage/errors';
import type { GithubProfile } from '@backstage/plugin-auth-backend-module-github-provider';
import type {
  AuthResolverContext,
  OAuthAuthenticatorResult,
  PassportProfile,
  SignInInfo,
} from '@backstage/plugin-auth-node';

/**
 * Domínios de e-mail autorizados a entrar pelo Google.
 *
 * Sem esta checagem, qualquer pessoa com uma conta Google entraria no hub e usaria o
 * scaffolder com o token da instância.
 */
export const ALLOWED_EMAIL_DOMAINS = ['valid.com'];

/**
 * Organização do GitHub cujos membros (ativos) podem entrar pelo GitHub.
 *
 * Sem esta checagem, qualquer conta do GitHub entraria no hub e usaria o scaffolder
 * com o token da instância.
 */
export const ALLOWED_GITHUB_ORG = 'Valid-Governo-Digital';

/**
 * Escopo extra pedido no login do GitHub, para que o token do próprio usuário possa
 * consultar a membership dele em organizações privadas.
 */
export const GITHUB_MEMBERSHIP_SCOPE = 'read:org';

type FetchFn = typeof fetch;

function issueUserToken(ctx: AuthResolverContext, name: string) {
  const userEntityRef = stringifyEntityRef({
    kind: 'User',
    name,
    namespace: DEFAULT_NAMESPACE,
  });

  return ctx.issueToken({
    claims: {
      sub: userEntityRef,
      ent: [userEntityRef],
    },
  });
}

/**
 * Os resolvers que acompanham o provider Google usam `signInWithCatalogUser`, que exige
 * uma entidade User no catálogo. O catálogo desta instância não tem nenhuma, então o
 * login falharia. Aqui emitimos o token diretamente, depois de exigir e-mail verificado
 * num dos domínios permitidos.
 */
export function createGoogleDomainSignInResolver(
  allowedDomains: string[] = ALLOWED_EMAIL_DOMAINS,
) {
  return async (
    { profile, result }: SignInInfo<OAuthAuthenticatorResult<PassportProfile>>,
    ctx: AuthResolverContext,
  ) => {
    if (!profile.email) {
      throw new NotAllowedError('O perfil do Google não retornou um e-mail');
    }

    // passport-google-oauth20 copia `email_verified` do userinfo para
    // emails[0].verified. O tipo do passport não declara o campo.
    const verified = (
      result.fullProfile.emails?.[0] as { verified?: unknown } | undefined
    )?.verified;
    if (verified !== true && verified !== 'true') {
      throw new NotAllowedError('O e-mail da conta Google não está verificado');
    }

    const [localPart, domain] = profile.email.toLowerCase().split('@');

    if (!localPart || !allowedDomains.includes(domain)) {
      throw new NotAllowedError(
        `Acesso restrito a contas ${allowedDomains
          .map(d => `@${d}`)
          .join(', ')}`,
      );
    }

    return issueUserToken(ctx, localPart);
  };
}

/**
 * Confere, com o token OAuth do próprio usuário, que ele é membro ATIVO da
 * organização. Qualquer resposta que não seja uma membership ativa reprova (fail
 * closed): não membro, convite pendente, OAuth App bloqueado pela org, SSO não
 * autorizado, token sem `read:org` ou GitHub fora do ar.
 */
export async function assertGithubOrgMember(options: {
  accessToken: string;
  org: string;
  fetchFn?: FetchFn;
}): Promise<void> {
  const { accessToken, org, fetchFn = fetch } = options;
  const url = `https://api.github.com/user/memberships/orgs/${encodeURIComponent(
    org,
  )}`;

  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'backstage-hub',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (error) {
    throw new ServiceUnavailableError(
      `Não foi possível confirmar a participação na organização ${org} do GitHub`,
      error,
    );
  }

  if (response.status === 200) {
    const membership = (await response.json().catch(() => undefined)) as
      | { state?: string; organization?: { login?: string } }
      | undefined;
    const sameOrg =
      membership?.organization?.login?.toLowerCase() === org.toLowerCase();
    if (sameOrg && membership?.state === 'active') {
      return;
    }
    if (sameOrg && membership?.state === 'pending') {
      throw new NotAllowedError(
        `O convite para a organização ${org} no GitHub ainda não foi aceito`,
      );
    }
    throw new NotAllowedError(
      `Acesso restrito a membros da organização ${org} no GitHub`,
    );
  }

  if (response.status === 401 || response.status === 404) {
    throw new NotAllowedError(
      `Acesso restrito a membros da organização ${org} no GitHub`,
    );
  }

  if (response.status === 403) {
    throw new NotAllowedError(
      `O GitHub negou a consulta à organização ${org}: o OAuth App precisa estar ` +
        `aprovado na organização (ou o token precisa de SSO/escopo ${GITHUB_MEMBERSHIP_SCOPE})`,
    );
  }

  throw new ServiceUnavailableError(
    `Não foi possível confirmar a participação na organização ${org} do GitHub (HTTP ${response.status})`,
  );
}

/**
 * Resolver do GitHub: só emite token para membro ativo de `org`. Roda no login e em
 * todo refresh de sessão, então quem sai da org perde o acesso no refresh seguinte.
 */
export function createGithubOrgSignInResolver(options?: {
  org?: string;
  fetchFn?: FetchFn;
}) {
  const org = options?.org ?? ALLOWED_GITHUB_ORG;
  const fetchFn = options?.fetchFn;

  return async (
    { result }: SignInInfo<OAuthAuthenticatorResult<GithubProfile>>,
    ctx: AuthResolverContext,
  ) => {
    const userId = result.fullProfile.username;
    if (!userId) {
      throw new NotAllowedError(
        'O perfil do GitHub não retornou um nome de usuário',
      );
    }

    await assertGithubOrgMember({
      accessToken: result.session.accessToken,
      org,
      fetchFn,
    });

    return issueUserToken(ctx, userId);
  };
}
