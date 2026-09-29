import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

async function generateContentWithRetry(
  model: ReturnType<typeof genAI.getGenerativeModel>,
  parts: any[],
  maxRetries = 3
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await model.generateContent(parts);
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

// FIX: naya helper — Strapi media library se image fetch karke
// base64 mein convert karta hai, taake Gemini Vision ko bheja ja sake.
// Sirf mobile flow use karega jab extractedText nahi diya gaya ho.
async function imageIdsToGeminiParts(imageIds: number[]) {
  const parts = [];

  for (const id of imageIds) {
    const file = await strapi.entityService.findOne("plugin::upload.file", id);
    if (!file || !file.url) continue;

    // file.url relative ho sakta hai (jaise "/uploads/xyz.jpg") ya absolute
    const fileUrl = file.url.startsWith("http")
      ? file.url
      : `${strapi.config.get("server.url")}${file.url}`;

    const response = await fetch(fileUrl);
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    parts.push({
      inlineData: {
        mimeType: file.mime || "image/jpeg",
        data: base64,
      },
    });
  }

  return parts;
}

export default {
  async generate(ctx: any) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized("You must be logged in.");
    }

    // FIX: extractedText ab optional hai — web isay bhejta hai (client-side
    // OCR ho chuka hota hai), mobile nahi bhejega (seedha images Gemini
    // Vision ko dega, jo khud text nikalega aur flashcards banayega)
    const { extractedText, studySessionId, density, imageIds } = ctx.request.body;

    if (!extractedText?.trim() && (!imageIds || imageIds.length === 0)) {
      return ctx.badRequest("Either extractedText or imageIds is required");
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

    // FIX: prompt ab dono cases handle karta hai — agar text diya gaya hai
    // to wahi use karo, warna Gemini ko batao ke woh khud images se text
    // padhe (OCR + extraction ek hi step mein, Vision capability se)
    const promptIntro = extractedText?.trim()
      ? `Read the following text extracted from a book page or lecture notes, and generate flashcards from it.`
      : `Read the attached image(s) of book pages or lecture notes (perform OCR yourself), and generate flashcards from the content.`;

    const promptBody = extractedText?.trim()
      ? `\nText:\n"""\n${extractedText}\n"""\n`
      : "";

    const prompt = `You are an expert study-material summarizer. ${promptIntro}

${densityInstruction}
${promptBody}
Respond with ONLY a valid JSON array (no markdown, no extra text, no code fences), where each item has this exact shape:
[
  { "keyword": "short term or concept", "answer": "concise correct answer", "explanation": "optional 1-2 sentence extra context" }
]

Generate between 3 and 15 cards depending on how much genuinely important content is in the text. Do not create a card for filler or unimportant sentences.`;

    try {
      const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

      // FIX: agar text nahi hai (mobile flow), to images ko Gemini Vision
      // parts mein convert karke prompt ke saath bhejo
      let contentParts: any[] = [prompt];
      let finalExtractedText = extractedText || "";

      if (!extractedText?.trim() && imageIds && imageIds.length > 0) {
        const imageParts = await imageIdsToGeminiParts(imageIds);
        contentParts = [prompt, ...imageParts];
      }

      const result = await generateContentWithRetry(model, contentParts);
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

      // FIX: agar mobile flow tha (extractedText nahi tha), sourcePage mein
      // ek placeholder note save karo taake field khali na rahe
      const sourcePage = await strapi.documents("api::source-page.source-page").create({
        data: {
          extractedText: finalExtractedText || "(extracted via AI Vision from uploaded image)",
          studySession: studySessionId,
          user: user.id,
          ...(imageIds && imageIds.length > 0 ? { image: imageIds } : {}),
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
            user: user.id,
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