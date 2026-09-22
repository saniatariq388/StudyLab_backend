import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

export default {
  async generate(ctx: any) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized("You must be logged in.");
    }

    const { extractedText, studySessionId, density } = ctx.request.body;

    if (!extractedText || !extractedText.trim()) {
      return ctx.badRequest("extractedText is required");
    }

    if (!studySessionId) {
      return ctx.badRequest("studySessionId is required");
    }

    // Verify the studySession belongs to this user
    const session = await strapi.documents("api::study-session.study-session").findOne({
      documentId: studySessionId,
      populate: ["user"],
    });

    if (!session) {
      return ctx.notFound("Study session not found.");
    }

    if ((session as any).user?.id !== user.id) {
      return ctx.forbidden("You do not have access to this study session.");
    }

    const densityInstruction =
      density === "detailed"
        ? "Extract detailed, comprehensive cards including mechanisms, cascades, and nuanced explanations."
        : "Extract only high-yield core concepts: key terms, definitions, and essential facts. Avoid redundant or filler cards.";

    const prompt = `You are an expert study-material summarizer. Read the following text extracted from a book page or lecture notes, and generate flashcards from it.

${densityInstruction}

Text:
"""
${extractedText}
"""

Respond with ONLY a valid JSON array (no markdown, no extra text, no code fences), where each item has this exact shape:
[
  { "keyword": "short term or concept", "answer": "concise correct answer", "explanation": "optional 1-2 sentence extra context" }
]

Generate between 3 and 15 cards depending on how much genuinely important content is in the text. Do not create a card for filler or unimportant sentences.`;

    try {
      const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });
      const result = await model.generateContent(prompt);
      const rawText = result.response.text();

      // Strip potential markdown code fences just in case
      const cleaned = rawText.replace(/```json|```/g, "").trim();

      let cards: { keyword: string; answer: string; explanation?: string }[];
      try {
        cards = JSON.parse(cleaned);
      } catch (parseError) {
        strapi.log.error("Failed to parse AI response as JSON:", rawText);
        return ctx.internalServerError("AI returned an unexpected format. Please try again.");
      }

      if (!Array.isArray(cards) || cards.length === 0) {
        return ctx.internalServerError("AI did not generate any flashcards.");
      }

      // Create a SourcePage to hold the extracted text
      const sourcePage = await strapi.documents("api::source-page.source-page").create({
        data: {
          extractedText,
          studySession: studySessionId,
        },
      });

      // Create a Flashcard entry for each generated card
      const createdCards = [];
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const created = await strapi.documents("api::flashcard.flashcard").create({
          data: {
            keyword: card.keyword,
            answer: card.answer,
            explanation: card.explanation || "",
            order: i + 1,
            studySession: studySessionId,
            sourcePage: sourcePage.documentId,
          },
        });
        createdCards.push(created);
      }

      // Update the session's totalCards count
      await strapi.documents("api::study-session.study-session").update({
        documentId: studySessionId,
        data: {
          totalCards: createdCards.length,
        },
      });

      ctx.send({
        sourcePage,
        flashcards: createdCards,
        count: createdCards.length,
      });
    } catch (error: any) {
      strapi.log.error("AI flashcard generation error:", error);
      ctx.internalServerError("Failed to generate flashcards");
    }
  },
};