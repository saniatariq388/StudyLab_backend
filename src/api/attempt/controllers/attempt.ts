import { factories } from '@strapi/strapi';

function sanitizeUser(user: any) {
  if (!user) return user;
  const { password, resetPasswordToken, confirmationToken, ...safeUser } = user;
  return safeUser;
}

export default factories.createCoreController('api::attempt.attempt', ({ strapi }) => ({

  async create(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized('You must be logged in to record an attempt.');
    }

    const { data } = ctx.request.body;

    if (!data.flashcard || !data.session) {
      return ctx.badRequest('flashcard and session are required.');
    }

    // Verify the session belongs to this user before allowing the attempt
    const session = await strapi.documents('api::study-session.study-session').findOne({
      documentId: data.session,
      populate: ['user'],
    });

    if (!session) {
      return ctx.notFound('Study session not found.');
    }

    if (session.user?.id !== user.id) {
      return ctx.forbidden('You do not have access to this study session.');
    }

    const entry = await strapi.documents('api::attempt.attempt').create({
      data: {
        ...data,
        user: user.id,
      },
      populate: ['user', 'session', 'flashcard'],
    });

    return { data: { ...entry, user: sanitizeUser(entry.user) } };
  },

  async find(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized('You must be logged in.');
    }
    
     
    const incomingFilters = (ctx.query as any).filters || {};

    const entries = await strapi.documents('api::attempt.attempt').findMany({
      filters: {
        ...incomingFilters,
        user: user.id, // always force ownership, client can't override this
      },
      populate:  (ctx.query as any).populate,
       sort: (ctx.query as any).sort,
    });

    const sanitized = (entries || []).map((entry: any) => ({
      ...entry,
      user: sanitizeUser(entry.user),
    }));

    return { data: sanitized, meta: {} };
  },

  async findOne(ctx) {
    const user = ctx.state.user;
    const { id } = ctx.params;

    if (!user) {
      return ctx.unauthorized('You must be logged in.');
    }

    const entity = await strapi.documents('api::attempt.attempt').findOne({
      documentId: id,
      populate: ['user', 'session', 'flashcard'],
    });

    if (!entity) {
      return ctx.notFound();
    }

    if (entity.user?.id !== user.id) {
      return ctx.forbidden('You do not have access to this attempt.');
    }

    return { data: { ...entity, user: sanitizeUser(entity.user) } };
  },

  async update(ctx) {
    const user = ctx.state.user;
    const { id } = ctx.params;

    if (!user) {
      return ctx.unauthorized('You must be logged in.');
    }

    const existing = await strapi.documents('api::attempt.attempt').findOne({
      documentId: id,
      populate: ['user'],
    });

    if (!existing) {
      return ctx.notFound();
    }

    if (existing.user?.id !== user.id) {
      return ctx.forbidden('You do not have access to this attempt.');
    }

    const { data } = ctx.request.body;

    const updated = await strapi.documents('api::attempt.attempt').update({
      documentId: id,
      data,
      populate: ['user', 'session', 'flashcard'],
    });

    return { data: { ...updated, user: sanitizeUser(updated?.user) } };
  },

  async delete(ctx) {
    const user = ctx.state.user;
    const { id } = ctx.params;

    if (!user) {
      return ctx.unauthorized('You must be logged in.');
    }

    const existing = await strapi.documents('api::attempt.attempt').findOne({
      documentId: id,
      populate: ['user'],
    });

    if (!existing) {
      return ctx.notFound();
    }

    if (existing.user?.id !== user.id) {
      return ctx.forbidden('You do not have access to this attempt.');
    }

    const deleted = await strapi.documents('api::attempt.attempt').delete({
      documentId: id,
    });

    return { data: deleted };
  },

}));