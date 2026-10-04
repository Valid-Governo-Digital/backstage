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

import type { AuthResolverContext } from '@backstage/plugin-auth-node';
import {
  assertGithubOrgMember,
  createGithubOrgSignInResolver,
  createGoogleDomainSignInResolver,
} from './signInResolvers';

const ORG = 'Valid-Governo-Digital';

function makeCtx() {
  const issueToken = jest.fn(async (params: any) => ({
    token: `token-for-${params.claims.sub}`,
  }));
  const ctx = { issueToken } as unknown as AuthResolverContext;
  return { ctx, issueToken };
}

function jsonResponse(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function membership(state: string, login = ORG) {
  return { state, role: 'member', organization: { login } };
}

function githubInfo(username?: string) {
  return {
    profile: {},
    result: {
      fullProfile: { provider: 'github', id: '1', displayName: 'x', username },
      session: {
        accessToken: 'user-oauth-token',
        tokenType: 'bearer',
        scope: 'read:user read:org',
      },
    },
  } as any;
}

describe('assertGithubOrgMember', () => {
  it('consulta a membership do próprio usuário com o token do login', async () => {
    const fetchFn = jest.fn(async () =>
      jsonResponse(200, membership('active')),
    );

    await expect(
      assertGithubOrgMember({ accessToken: 'abc', org: ORG, fetchFn }),
    ).resolves.toBeUndefined();

    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.github.com/user/memberships/orgs/Valid-Governo-Digital',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer abc' }),
      }),
    );
  });

  it('aceita a org com outra caixa no login', async () => {
    const fetchFn = jest.fn(async () =>
      jsonResponse(200, membership('active', 'valid-governo-digital')),
    );
    await expect(
      assertGithubOrgMember({ accessToken: 'abc', org: ORG, fetchFn }),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['convite pendente', 200, membership('pending'), 'NotAllowedError'],
    [
      'membership de outra org',
      200,
      membership('active', 'outra'),
      'NotAllowedError',
    ],
    ['200 sem corpo', 200, undefined, 'NotAllowedError'],
    ['não membro (404)', 404, { message: 'Not Found' }, 'NotAllowedError'],
    [
      'token inválido (401)',
      401,
      { message: 'Bad credentials' },
      'NotAllowedError',
    ],
    [
      'OAuth App bloqueado pela org (403)',
      403,
      { message: 'restricted' },
      'NotAllowedError',
    ],
    ['GitHub fora do ar (502)', 502, undefined, 'ServiceUnavailableError'],
  ])('reprova: %s', async (_label, status, body, errorName) => {
    const fetchFn = jest.fn(async () => jsonResponse(status, body));
    await expect(
      assertGithubOrgMember({ accessToken: 'abc', org: ORG, fetchFn }),
    ).rejects.toMatchObject({ name: errorName });
  });

  it('reprova quando a chamada ao GitHub falha', async () => {
    const fetchFn = jest.fn(async () => {
      throw new Error('ECONNRESET');
    });
    await expect(
      assertGithubOrgMember({ accessToken: 'abc', org: ORG, fetchFn }),
    ).rejects.toMatchObject({ name: 'ServiceUnavailableError' });
  });
});

describe('createGithubOrgSignInResolver', () => {
  it('emite token para membro ativo da org', async () => {
    const fetchFn = jest.fn(async () =>
      jsonResponse(200, membership('active')),
    );
    const { ctx, issueToken } = makeCtx();

    const result = await createGithubOrgSignInResolver({ fetchFn })(
      githubInfo('octocat'),
      ctx,
    );

    expect(result).toEqual({ token: 'token-for-user:default/octocat' });
    expect(issueToken).toHaveBeenCalledWith({
      claims: {
        sub: 'user:default/octocat',
        ent: ['user:default/octocat'],
      },
    });
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining('/user/memberships/orgs/Valid-Governo-Digital'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer user-oauth-token',
        }),
      }),
    );
  });

  it('não emite token para conta fora da org', async () => {
    const fetchFn = jest.fn(async () => jsonResponse(404, {}));
    const { ctx, issueToken } = makeCtx();

    await expect(
      createGithubOrgSignInResolver({ fetchFn })(githubInfo('estranho'), ctx),
    ).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(issueToken).not.toHaveBeenCalled();
  });

  it('não consulta a org nem emite token sem username', async () => {
    const fetchFn = jest.fn();
    const { ctx, issueToken } = makeCtx();

    await expect(
      createGithubOrgSignInResolver({ fetchFn })(githubInfo(undefined), ctx),
    ).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(issueToken).not.toHaveBeenCalled();
  });
});

describe('createGoogleDomainSignInResolver', () => {
  function googleInfo(email: string | undefined, verified: unknown = true) {
    return {
      profile: { email },
      result: {
        fullProfile: {
          provider: 'google',
          id: '1',
          displayName: 'x',
          emails: email ? [{ value: email, verified }] : undefined,
        },
        session: { accessToken: 't', tokenType: 'bearer', scope: '' },
      },
    } as any;
  }

  it('emite token para e-mail verificado @valid.com', async () => {
    const { ctx, issueToken } = makeCtx();
    await createGoogleDomainSignInResolver()(
      googleInfo('Fulano.Silva@Valid.com'),
      ctx,
    );
    expect(issueToken).toHaveBeenCalledWith({
      claims: {
        sub: 'user:default/fulano.silva',
        ent: ['user:default/fulano.silva'],
      },
    });
  });

  it.each([
    ['outro domínio', googleInfo('alguem@gmail.com')],
    ['subdomínio parecido', googleInfo('alguem@valid.com.evil.io')],
    ['e-mail não verificado', googleInfo('alguem@valid.com', false)],
    ['sem e-mail', googleInfo(undefined)],
  ])('reprova: %s', async (_label, info) => {
    const { ctx, issueToken } = makeCtx();
    await expect(
      createGoogleDomainSignInResolver()(info, ctx),
    ).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(issueToken).not.toHaveBeenCalled();
  });
});
