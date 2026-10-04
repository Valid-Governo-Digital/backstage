# Desprovisionar ${{ values.name }}

Apagar o repositório **não** remove a infraestrutura. Cada ambiente mantém um load balancer próprio
(~US$ 18/mês), então rode os três passos abaixo ao encerrar o serviço.

```bash
PROJECT=validid-governodigital-sandbox

gcloud container clusters get-credentials authid-cluster \
  --region southamerica-east1 --project "$PROJECT"

# 1. Workloads, service, ingress e certificado
kubectl delete namespace ${{ values.name }}

# 2. Registro DNS
gcloud dns record-sets delete ${{ values.host }}. \
  --zone=valid --type=A --project="$PROJECT"

# 3. IP estático global (só é liberado depois que o ingress some — aguarde alguns minutos)
gcloud compute addresses delete ${{ values.name }}-ip --global --project="$PROJECT"
```

Opcionalmente, remova também as imagens:

```bash
gcloud container images delete gcr.io/$PROJECT/${{ values.name }} --force-delete-tags --quiet
```

Confira que nada ficou para trás:

```bash
gcloud compute addresses list --global --project="$PROJECT" --filter='name~${{ values.name }}'
gcloud dns record-sets list --zone=valid --project="$PROJECT" --filter='name~${{ values.name }}'
```
