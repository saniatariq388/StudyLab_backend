import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::source-page.source-page', ({ strapi }) => ({

  async create(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized('You must be logged in to upload a source page.');
    }

    const { data } = ctx.request.body;

    if (!data.studySession) {
      return ctx.badRequest('studySession is required.');
    }

    // Verify the studySession belongs to this user before allowing the source page to attach to it
    const session = await strapi.documents('api::study-session.study-session').findOne({
      documentId: data.studySession,
      populate: ['user'],
    });

    if (!session) {
      return ctx.notFound('Study session not found.');
    }

    if (session.user?.id !== user.id) {
      return ctx.forbidden('You do not have access to this study session.');
    }

    const entry = await strapi.documents('api::source-page.source-page').create({
      data,
      populate: ['studySession'],
    });

    return { data: entry };
  },

  async find(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized('You must be logged in.');
    }

    // Only return source pages whose studySession belongs to this user
   const incomingFilters = (ctx.query as any).filters || {};

  const entries = await strapi.documents('api::source-page.source-page').findMany({
    filters: {
      ...incomingFilters,
      studySession: {
        ...(incomingFilters.studySession || {}),
        user: user.id,
      },
    },
    populate: (ctx.query as any).populate,
    sort: (ctx.query as any).sort,
  });

    return { data: entries || [], meta: {} };
  },

  async findOne(ctx) {
    const user = ctx.state.user;
    const { id } = ctx.params;

    if (!user) {
      return ctx.unauthorized('You must be logged in.');
    }

    const entity = await strapi.documents('api::source-page.source-page').findOne({
      documentId: id,
      populate: { studySession: { populate: ['user'] } },
    });

    if (!entity) {
      return ctx.notFound();
    }

    if ((entity.studySession as any)?.user?.id !== user.id) {
      return ctx.forbidden('You do not have access to this source page.');
    }

    return { data: entity };
  },

  async update(ctx) {
    const user = ctx.state.user;
    const { id } = ctx.params;

    if (!user) {
      return ctx.unauthorized('You must be logged in.');
    }

    const existing = await strapi.documents('api::source-page.source-page').findOne({
      documentId: id,
      populate: { studySession: { populate: ['user'] } },
    });

    if (!existing) {
      return ctx.notFound();
    }

    if ((existing.studySession as any)?.user?.id !== user.id) {
      return ctx.forbidden('You do not have access to this source page.');
    }

    const { data } = ctx.request.body;

    const updated = await strapi.documents('api::source-page.source-page').update({
      documentId: id,
      data,
      populate: ['studySession'],
    });

    return { data: updated };
  },

  async delete(ctx) {
    const user = ctx.state.user;
    const { id } = ctx.params;

    if (!user) {
      return ctx.unauthorized('You must be logged in.');
    }

    const existing = await strapi.documents('api::source-page.source-page').findOne({
      documentId: id,
      populate: { studySession: { populate: ['user'] } },
    });

    if (!existing) {
      return ctx.notFound();
    }

    if ((existing.studySession as any)?.user?.id !== user.id) {
      return ctx.forbidden('You do not have access to this source page.');
    }

    const deleted = await strapi.documents('api::source-page.source-page').delete({
      documentId: id,
    });

    return { data: deleted };
  },

}));