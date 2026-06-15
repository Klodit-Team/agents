import { connectMcp, closeAll } from "../shared/mcpClient.js";
import { callTool } from "../shared/tooling.js";

const aoId = process.env.AO_ID;
const sectionType = process.env.SECTION_TYPE;
const userPrompt = process.env.USER_PROMPT ?? "";
const sensitivity =
  (process.env.LLM_SENSITIVITY as
    | "highly_sensitive"
    | "sensitive"
    | "non_sensitive") ?? "non_sensitive";

if (!aoId) {
  throw new Error("AO_ID is required");
}
if (!sectionType) {
  throw new Error("SECTION_TYPE is required");
}

const aoConn = await connectMcp("MCP_AO");
const llmConn = await connectMcp("MCP_LLM");
const auditConn = await connectMcp("MCP_AUDIT");

try {
  const ao = await callTool<Record<string, unknown>>(
    aoConn.client,
    "get_appel_offres",
    { aoId }
  );
  const criteres = await callTool<Record<string, unknown>>(
    aoConn.client,
    "get_criteres_evaluation",
    { aoId }
  );

  const draft = await callTool<Record<string, unknown> | string>(
    llmConn.client,
    "draft_cdc_section",
    {
      sensitivity,
      prompt: userPrompt,
      context: { ao, criteres },
      sectionType,
    }
  );

  const biasCheck = await callTool<Record<string, unknown> | string>(
    llmConn.client,
    "detect_bias",
    {
      sensitivity,
      prompt: typeof draft === "string" ? draft : JSON.stringify(draft),
      context: { ao, criteres },
    }
  );

  const hasBias =
    typeof biasCheck === "object" &&
    biasCheck !== null &&
    (biasCheck as Record<string, unknown>).hasBias === true;

  const finalDraft = hasBias
    ? await callTool<Record<string, unknown> | string>(
        llmConn.client,
        "complete",
        {
          sensitivity,
          prompt: "Rewrite the CDC section to remove any discriminatory clauses.",
          context: {
            draft,
            bias: biasCheck,
          },
        }
      )
    : draft;

  await callTool(auditConn.client, "log_ia_decision", {
    agentName: "genai_cdc_assistant",
    entite: "appel_offre",
    entiteId: aoId,
    action: "cdc_draft",
    details: "Generated CDC draft section",
    horodatage: new Date().toISOString(),
  });

  const draftText = typeof finalDraft === "string" ? finalDraft : JSON.stringify(finalDraft);
  const correctedText = hasBias
    ? draftText
    : undefined;
  const originalText = hasBias
    ? (typeof draft === "string" ? draft : JSON.stringify(draft))
    : draftText;

  console.log(
    JSON.stringify({
      draft: originalText,
      biasDetected: hasBias,
      ...(correctedText !== undefined ? { correctedDraft: correctedText } : {}),
    }),
  );
} finally {
  await closeAll([aoConn, llmConn, auditConn]);
}
