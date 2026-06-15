import { connectMcp, closeAll } from "../shared/mcpClient.js";
import {
  callTool,
  asArray,
  firstProp,
  pickFirstText,
} from "../shared/tooling.js";

const aoId = process.env.AO_ID;
const evaluationIdOverride = process.env.EVALUATION_ID;

if (!aoId) {
  throw new Error("AO_ID is required");
}

const evaluationConn = await connectMcp("MCP_EVALUATION");
const soumissionsConn = await connectMcp("MCP_SOUMISSIONS");
const analysisConn = await connectMcp("MCP_DOCUMENT_ANALYSIS");
const llmConn = await connectMcp("MCP_LLM");
const auditConn = await connectMcp("MCP_AUDIT");

try {
  const grille = await callTool<Record<string, unknown> | unknown[]>(
    evaluationConn.client,
    "get_grille_evaluation",
    { aoId }
  );

  const evaluationContext = await callTool<Record<string, unknown>>(
    evaluationConn.client,
    "get_evaluation_context",
    { aoId }
  );

  let evaluationId: string | undefined;
  if (typeof evaluationContext === "object" && evaluationContext !== null) {
    evaluationId =
      (evaluationIdOverride as string | undefined) ??
      firstProp(evaluationContext, "id", "evaluationId");
  }

  if (!evaluationId) {
    throw new Error("Unable to resolve evaluationId");
  }

  const criteriaList = Array.isArray(grille)
    ? grille
    : ((grille as Record<string, unknown>)?.criteres as unknown[]) ?? [];

  const soumissionsPayload = await callTool<unknown[]>(
    soumissionsConn.client,
    "list_soumissions",
    { aoId }
  );
  const soumissions = asArray(soumissionsPayload);

  for (const soumission of soumissions) {
    const soumissionId =
      (soumission.id as string | undefined) ??
      (soumission.soumissionId as string | undefined);
    if (!soumissionId) {
      continue;
    }

    const offre = await callTool<Record<string, unknown>>(
      soumissionsConn.client,
      "get_offre_technique_url",
      { soumissionId }
    );

    const fileUrl =
      (offre?.url as string | undefined) ??
      (offre?.fichierUrl as string | undefined);

    if (!fileUrl) {
      continue;
    }

    const extractText = await callTool<Record<string, unknown>>(
      analysisConn.client,
      "extract_text",
      { fileUrl }
    );

    const offerText =
      (extractText?.text as string | undefined) ??
      (extractText?.content as string | undefined) ??
      JSON.stringify(extractText);

    const notes: Array<Record<string, unknown>> = [];

    for (const criterion of criteriaList) {
      const criterionId =
        (criterion as Record<string, unknown>).id ??
        (criterion as Record<string, unknown>).criterionId ??
        (criterion as Record<string, unknown>).critereId;

      if (!criterionId || typeof criterionId !== "string") {
        continue;
      }

      const scoring = await callTool<Record<string, unknown>>(
        llmConn.client,
        "complete",
        {
          sensitivity: "highly_sensitive",
          prompt:
            "Score this offer against the criterion and return JSON {score, justification, confidence}.",
          context: {
            offerText,
            criterion,
          },
        }
      );

      if (!scoring || typeof scoring !== "object") {
        continue;
      }

      const score = (scoring as Record<string, unknown>).score as number;
      const justification =
        (scoring as Record<string, unknown>).justification as string;
      const confidence =
        (scoring as Record<string, unknown>).confidence as number | undefined;

      if (typeof score !== "number" || !justification) {
        continue;
      }

      await callTool(evaluationConn.client, "write_ia_notes", {
        evaluationId,
        submissionId: soumissionId,
        criterionId,
        score,
        justification,
        confidence,
      });

      notes.push({ criterionId, score, justification, confidence });
    }

    const aggregate = await callTool<Record<string, unknown>>(
      llmConn.client,
      "complete",
      {
        sensitivity: "highly_sensitive",
        prompt:
          "Aggregate criterion scores and return JSON {scoreTechnique, scoreFinancier, scoreGlobal, ranking, recommendation}.",
        context: { notes },
      }
    );

    if (aggregate && typeof aggregate === "object") {
      await callTool(evaluationConn.client, "write_score_ia", {
        evaluationId,
        submissionId: soumissionId,
        scoreTechnique: (aggregate as Record<string, unknown>).scoreTechnique,
        scoreFinancier: (aggregate as Record<string, unknown>).scoreFinancier,
        scoreGlobal: (aggregate as Record<string, unknown>).scoreGlobal,
        ranking: (aggregate as Record<string, unknown>).ranking,
        recommendation: (aggregate as Record<string, unknown>).recommendation,
      });
    }
  }

  await callTool(auditConn.client, "log_ia_decision", {
    agentName: "evaluation_assistant",
    entite: "appel_offre",
    entiteId: aoId,
    action: "evaluation_scoring",
    details: "Completed evaluation scoring workflow",
    horodatage: new Date().toISOString(),
  });
} finally {
  await closeAll([
    evaluationConn,
    soumissionsConn,
    analysisConn,
    llmConn,
    auditConn,
  ]);
}
