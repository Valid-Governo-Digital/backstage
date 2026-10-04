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
import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { SignInPageBlueprint } from '@backstage/plugin-app-react';
import { SignInPage } from '@backstage/core-components';
import {
  githubAuthApiRef,
  googleAuthApiRef,
} from '@backstage/core-plugin-api';

/**
 * Substitui a tela de login padrão, que é fixa em `providers={['guest']}`
 * (plugins/app/src/extensions/DefaultSignInPage.tsx). O provider guest se recusa a
 * autenticar quando NODE_ENV !== 'development', então em produção o login só funciona
 * com um provider real.
 *
 * Os providers do backend ficam em packages/backend/src/authModule{Github,Google}Provider.ts.
 * O do Google restringe a entrada aos domínios permitidos; o do GitHub aceita qualquer
 * conta do GitHub, então trate-o como conveniência, não como controle de acesso.
 */
export const appModuleSignInPage = createFrontendModule({
  pluginId: 'app',
  extensions: [
    SignInPageBlueprint.make({
      params: {
        loader: async () => props =>
          (
            <SignInPage
              {...props}
              title="Entrar"
              align="center"
              providers={[
                {
                  id: 'google-auth-provider',
                  title: 'Google',
                  message: 'Entre com sua conta Valid',
                  apiRef: googleAuthApiRef,
                },
                {
                  id: 'github-auth-provider',
                  title: 'GitHub',
                  message: 'Entre com sua conta do GitHub',
                  apiRef: githubAuthApiRef,
                },
              ]}
            />
          ),
      },
    }),
  ],
});
