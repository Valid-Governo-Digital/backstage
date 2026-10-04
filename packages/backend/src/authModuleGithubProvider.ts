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
import { githubAuthenticator } from '@backstage/plugin-auth-backend-module-github-provider';
import {
  authProvidersExtensionPoint,
  createOAuthProviderFactory,
} from '@backstage/plugin-auth-node';
import {
  createGithubOrgSignInResolver,
  GITHUB_MEMBERSHIP_SCOPE,
} from './signInResolvers';

/**
 * Login pelo GitHub restrito aos membros ativos de Valid-Governo-Digital.
 *
 * O resolver consulta a membership com o token do próprio login, por isso o escopo
 * `read:org` é pedido sempre (além do `read:user` obrigatório do provider).
 */
export default createBackendModule({
  pluginId: 'auth',
  moduleId: 'githubProvider',
  register(reg) {
    reg.registerInit({
      deps: { providers: authProvidersExtensionPoint },
      async init({ providers }) {
        providers.registerProvider({
          providerId: 'github',
          factory: createOAuthProviderFactory({
            authenticator: githubAuthenticator,
            additionalScopes: [GITHUB_MEMBERSHIP_SCOPE],
            signInResolver: createGithubOrgSignInResolver(),
          }),
        });
      },
    });
  },
});
