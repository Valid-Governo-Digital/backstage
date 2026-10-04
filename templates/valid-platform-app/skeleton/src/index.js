const express = require('express');

const app = express();
const port = Number(process.env.PORT) || ${{ values.port }};

app.get('/', (_req, res) => {
  res.json({
    service: '${{ values.name }}',
    message: 'Hello from ${{ values.name }}',
  });
});

// Consumido pelas probes do Kubernetes e pelo health check do load balancer.
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`${{ values.name }} listening on port ${port}`);
});

// O GCLB drena conexões por até 60s; encerrar sem esperar gera 502 durante o rollout.
const shutdown = signal => () => {
  console.log(`received ${signal}, shutting down`);
  server.close(() => process.exit(0));
};

process.on('SIGTERM', shutdown('SIGTERM'));
process.on('SIGINT', shutdown('SIGINT'));
