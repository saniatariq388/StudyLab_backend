import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

// FIX: naya helper function add kiya. Gemini kabhi kabhi 503
// ("model is currently experiencing high demand") deta hai, jo
// temporary hota hai. Yeh function 3 baar tak retry karega, har
// attempt ke darmiyan thoda zyada wait karte hue (1.5s, 3s, 4.5s),
// taake user ko manually "Try Again" na dabana pade aur zyada tar
// temporary overload khud hi resolve ho jaye.
async function generateContentWithRetry(
  model: ReturnType<typeof genAI.getGenerativeModel>,
  prompt: string,
  maxRetries = 3
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await model.generateContent(prompt);
    } catch (err: any) {
      const is503 =
        err?.status === 503 ||
        String(err?.message || "").includes("503") ||
        String(err?.message || "").toLowerCase().includes("overloaded") ||
        String(err?.message || "").toLowerCase().includes("high demand");
      const isLastAttempt = attempt === maxRetries;
      if (is503 && !isLastAttempt) {
        strapi.log.warn(`Gemini overloaded (attempt ${attempt}/${maxRetries}), retrying...`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Failed to generate content after retries.");
}

export default {
  async generate(ctx: any) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized("You must be logged in.");
    }

    // FIX: imageIds bhi request body se le rahe hain (frontend se
    // uploadImages() ke baad mile hue Strapi media IDs)
    const { extractedText, studySessionId, density, imageIds } = ctx.request.body;

    if (!extractedText || !extractedText.trim()) {
      return ctx.badRequest("extractedText is required");
    }

    if (!studySessionId) {
      return ctx.badRequest("studySessionId is required");
    }

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
      const result = await generateContentWithRetry(model, prompt);
      const rawText = result.response.text();
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

      const sourcePage = await strapi.documents("api::source-page.source-page").create({
        data: {
          extractedText,
          studySession: studySessionId,
          user: user.id, // FIX: user relation set kar rahe hain
          ...(imageIds && imageIds.length > 0 ? { image: imageIds } : {}), // FIX: uploaded images link kar rahe hain
        },
      });

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
            user: user.id, // FIX: yahan bhi user relation set kar rahe hain
          },
        });
        createdCards.push(created);
      }

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
      const isOverloaded =
        error?.status === 503 ||
        String(error?.message || "").toLowerCase().includes("high demand") ||
        String(error?.message || "").toLowerCase().includes("overloaded");

      if (isOverloaded) {
        return ctx.internalServerError("The AI model is currently busy. Please try again in a moment.");
      }
      ctx.internalServerError("Failed to generate flashcards");
    }
  },
};