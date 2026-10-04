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

import { createBackendModule } from '@backstage/backend-plugin-api';
import {
  DEFAULT_NAMESPACE,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import { googleAuthenticator } from '@backstage/plugin-auth-backend-module-google-provider';
import {
  authProvidersExtensionPoint,
  createOAuthProviderFactory,
} from '@backstage/plugin-auth-node';
import { NotAllowedError } from '@backstage/errors';

/**
 * Domínios de e-mail autorizados a entrar no portal.
 *
 * Este é o controle de acesso real da instância: o resolver rejeita qualquer conta
 * Google fora destes domínios. Sem isso, qualquer pessoa com uma conta Google entraria.
 */
const ALLOWED_EMAIL_DOMAINS = ['valid.com'];

/**
 * Os resolvers que acompanham o provider Google usam `signInWithCatalogUser`, que exige
 * uma entidade User no catálogo. O catálogo desta instância não tem nenhuma, então o
 * login falharia. Aqui emitimos o token diretamente, como já é feito para o GitHub em
 * ./authModuleGithubProvider.
 */
export default createBackendModule({
  pluginId: 'auth',
  moduleId: 'googleProvider',
  register(reg) {
    reg.registerInit({
      deps: { providers: authProvidersExtensionPoint },
      async init({ providers }) {
        providers.registerProvider({
          providerId: 'google',
          factory: createOAuthProviderFactory({
            authenticator: googleAuthenticator,
            async signInResolver({ profile }, ctx) {
              if (!profile.email) {
                throw new NotAllowedError(
                  'O perfil do Google não retornou um e-mail',
                );
              }

              const [localPart, domain] = profile.email
                .toLowerCase()
                .split('@');

              if (!ALLOWED_EMAIL_DOMAINS.includes(domain)) {
                throw new NotAllowedError(
                  `Acesso restrito a contas ${ALLOWED_EMAIL_DOMAINS.map(
                    d => `@${d}`,
                  ).join(', ')}`,
                );
              }

              const userEntityRef = stringifyEntityRef({
                kind: 'User',
                name: localPart,
                namespace: DEFAULT_NAMESPACE,
              });

              return ctx.issueToken({
                claims: {
                  sub: userEntityRef,
                  ent: [userEntityRef],
                },
              });
            },
          }),
        });
      },
    });
  },
});
