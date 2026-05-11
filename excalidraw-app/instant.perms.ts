// Docs: https://www.instantdb.com/docs/permissions

export default {
  boards: {
    allow: {
      // Public boards are visible to anyone; private boards only to their owner
      view: "data.isPublic == true || (auth.id != null && auth.id == data.ownerId)",
      create: "auth.id != null",
      update: "auth.id != null && auth.id == data.ownerId",
      delete: "auth.id != null && auth.id == data.ownerId",
    },
  },
};
