import 'fastify';
declare module 'fastify' {
  interface FastifyInstance {
    requireAuth(request: FastifyRequest): Promise<void>;
  }
}
