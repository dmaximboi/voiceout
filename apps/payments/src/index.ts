import Fastify from 'fastify';

const port = Number(process.env.PAYMENTS_PORT ?? 4002);
const app = Fastify({ logger: true });

app.get('/health', async () => ({ ok: true, service: 'payments', enabled: false }));

app.all('/*', async (_req, reply) => {
  return reply.code(501).send({
    error: 'Payments are not enabled in VoiceOut v1',
    code: 'PAYMENTS_STUB',
  });
});

await app.listen({ port, host: '0.0.0.0' });
