import { factories } from '@strapi/strapi';

function sanitizeUser(user: any) {
  if (!user) return user;
  const { password, resetPasswordToken, confirmationToken, ...safeUser } = user;
  return safeUser;
}

export default factories.createCoreController('api::study-session.study-session', ({ strapi }) => ({

  async create(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized('You must be logged in to create a session.');
    }

    const { data } = ctx.request.body;

    const entry = await strapi.documents('api::study-session.study-session').create({
      data: {
        ...data,
        user: user.id,
      },
      populate: ['user', 'folder'],
    });

    return { data: { ...entry, user: sanitizeUser(entry.user) } };
  },

  async find(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized('You must be logged in to view sessions.');
    }
     const incomingFilters = (ctx.query as any).filters || {};

    const entries = await strapi.documents('api::study-session.study-session').findMany({
      filters: {
        ...incomingFilters,
        user: user.id,
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

    const entity = await strapi.documents('api::study-session.study-session').findOne({
      documentId: id,
      populate: ['user', 'folder'],
    });

    if (!entity) {
      return ctx.notFound();
    }

    if (entity.user?.id !== user.id) {
      return ctx.forbidden('You do not have access to this session.');
    }

    return { data: { ...entity, user: sanitizeUser(entity.user) } };
  },

  async update(ctx) {
    const user = ctx.state.user;
    const { id } = ctx.params;

    if (!user) {
      return ctx.unauthorized('You must be logged in.');
    }

    const existing = await strapi.documents('api::study-session.study-session').findOne({
      documentId: id,
      populate: ['user'],
    });

    if (!existing) {
      return ctx.notFound();
    }

    if (existing.user?.id !== user.id) {
      return ctx.forbidden('You do not have access to this session.');
    }

    const { data } = ctx.request.body;

    const updated = await strapi.documents('api::study-session.study-session').update({
      documentId: id,
      data,
      populate: ['user', 'folder'],
    });

    return { data: { ...updated, user: sanitizeUser(updated?.user) } };
  },

  async delete(ctx) {
    const user = ctx.state.user;
    const { id } = ctx.params;

    if (!user) {
      return ctx.unauthorized('You must be logged in.');
    }

    const existing = await strapi.documents('api::study-session.study-session').findOne({
      documentId: id,
      populate: ['user'],
    });

    if (!existing) {
      return ctx.notFound();
    }

    if (existing.user?.id !== user.id) {
      return ctx.forbidden('You do not have access to this session.');
    }

    const deleted = await strapi.documents('api::study-session.study-session').delete({
      documentId: id,
    });

    return { data: deleted };
  },

}));