import { connectMcp, closeAll } from "../shared/mcpClient.js";
import { callTool, pickFirstText } from "../shared/tooling.js";

const aoId = process.env.AO_ID;
const gagId = process.env.GAG_ID;
const userId = process.env.USER_ID;
const justificationText = process.env.JUSTIFICATION_TEXT;
const rulesRaw = process.env.REGULATORY_RULES_JSON;
const supportingDocsRaw = process.env.SUPPORTING_DOCUMENT_IDS_JSON;

if (!aoId || !gagId || !userId || !justificationText) {
  throw new Error("AO_ID, GAG_ID, USER_ID, JUSTIFICATION_TEXT are required");
}

const rules = rulesRaw ? (JSON.parse(rulesRaw) as string[]) : [];
const supportingDocs = supportingDocsRaw
  ? (JSON.parse(supportingDocsRaw) as string[])
  : [];

const aoConn = await connectMcp("MCP_AO");
const usersConn = await connectMcp("MCP_USERS");
const documentsConn = await connectMcp("MCP_DOCUMENTS");
const storageConn = await connectMcp("MCP_STORAGE");
const analysisConn = await connectMcp("MCP_DOCUMENT_ANALYSIS");
const llmConn = await connectMcp("MCP_LLM");
const auditConn = await connectMcp("MCP_AUDIT");

try {
  const ao = await callTool<Record<string, unknown>>(
    aoConn.client,
    "get_appel_offres",
    { aoId }
  );

  const orgProfile = await callTool<Record<string, unknown>>(
    usersConn.client,
    "get_organisation_profile",
    { userId }
  );

  const supportingTexts: string[] = [];
  for (const documentId of supportingDocs) {
    const docRef = await callTool<Record<string, unknown> | string>(
      documentsConn.client,
      "get_document_url",
      { documentId }
    );

    let fileUrl: string | undefined;
    if (typeof docRef === "string") {
      fileUrl = docRef;
    } else if (docRef && typeof docRef === "object") {
      fileUrl =
        (docRef as Record<string, unknown>).url as string | undefined;
      const storageKey =
        (docRef as Record<string, unknown>).storageKey as string | undefined;
      if (!fileUrl && storageKey) {
        const presigned = await callTool<Record<string, unknown>>(
          storageConn.client,
          "get_presigned_url",
          { objectKey: storageKey }
        );
        fileUrl = presigned?.url as string | undefined;
      }
    }

    if (!fileUrl) {
      continue;
    }

    const textResult = await callTool<Record<string, unknown>>(
      analysisConn.client,
      "extract_text",
      { fileUrl }
    );
    const text = pickFirstText(textResult);
    if (text) {
      supportingTexts.push(text);
    }
  }

  const justificationScore = await callTool<Record<string, unknown>>(
    llmConn.client,
    "score_justification",
    {
      sensitivity: "sensitive",
      prompt: justificationText,
      context: {
        ao,
        orgProfile,
        supportingTexts,
      },
      rules,
    }
  );

  const risk = await callTool<Record<string, unknown>>(
    llmConn.client,
    "classify_risk",
    {
      sensitivity: "sensitive",
      prompt: justificationText,
      context: {
        ao,
        orgProfile,
        supportingTexts,
      },
    }
  );

  const decision = await callTool<Record<string, unknown>>(
    llmConn.client,
    "complete",
    {
      sensitivity: "sensitive",
      prompt:
        "Combine the justification score, risk classification, and organisation profile into a final decision. Return JSON {scoreConformite, recommandation, justificationIa, confianceScore}.",
      context: {
        justificationScore,
        risk,
        orgProfile,
      },
    }
  );

  await callTool(aoConn.client, "update_gre_a_gre_score", {
    gagId,
    modeleIa: "gre-a-gre-agent",
    scoreConformite: (decision as Record<string, unknown>).scoreConformite,
    recommandation: (decision as Record<string, unknown>).recommandation,
    justificationIa: (decision as Record<string, unknown>).justificationIa,
    confianceScore: (decision as Record<string, unknown>).confianceScore,
  });

  await callTool(auditConn.client, "log_ia_decision", {
    agentName: "gre_a_gre_agent",
    entite: "gre_a_gre",
    entiteId: gagId,
    action: "gre_a_gre_scoring",
    details: "Completed gre-a-gre workflow",
    horodatage: new Date().toISOString(),
  });
} finally {
  await closeAll([
    aoConn,
    usersConn,
    documentsConn,
    storageConn,
    analysisConn,
    llmConn,
    auditConn,
  ]);
}
