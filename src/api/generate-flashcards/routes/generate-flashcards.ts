export default {
  routes: [
    {
      method: "POST",
      path: "/generate-flashcards",
      handler: "generate-flashcards.generate",
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};