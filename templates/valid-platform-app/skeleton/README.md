# ${{ values.name }}

${{ values.description }}

- **Ambiente:** https://${{ values.host }}
- **Namespace:** `${{ values.name }}` no cluster `authid-cluster` (`southamerica-east1`)
- **Imagem:** `gcr.io/validid-governodigital-sandbox/${{ values.name }}`

## Desenvolvimento

```bash
npm install
npm start          # http://localhost:${{ values.port }}
```

Rotas: `GET /` e `GET /health` (usada pelas probes do Kubernetes e pelo health check do load balancer).

## Deploy

Todo push na `main` dispara [.github/workflows/deploy.yml](.github/workflows/deploy.yml), que constrói a imagem,
garante o IP estático e o registro DNS, e aplica os manifests de [k8s/](k8s/). Não há passo manual.

Na primeira execução o ambiente demora a responder:

| Tempo | Estado |
| --- | --- |
| ~3-5 min | Imagem publicada, pods no ar, IP e DNS criados |
| ~5-10 min | Load balancer programado — até aqui `404`/`502` é esperado |
| ~15-60 min | Certificado TLS emitido; o HTTPS passa a funcionar |

```bash
kubectl -n ${{ values.name }} get managedcertificate ${{ values.name }}-cert
```

O deploy depende do secret de organização `GCP_SA_KEY`.

## Configuração

`deploy.env` guarda os valores usados pelo workflow (nome, domínio, namespace, porta). O workflow em si é genérico —
ajuste `deploy.env` em vez de editá-lo.

Para desprovisionar o ambiente, veja [DEPROVISION.md](DEPROVISION.md).
