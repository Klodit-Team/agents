import { connectMcp, closeAll } from "../shared/mcpClient.js";
import { callTool, pickFirstText, pickNumber, asArray } from "../shared/tooling.js";

const submissionId = process.env.SUBMISSION_ID;
const requiredFieldsRaw = process.env.REQUIRED_FIELDS_JSON;
const fieldsSchemaRaw = process.env.FIELDS_SCHEMA_JSON;
const confidenceThreshold = Number(process.env.CONFIDENCE_THRESHOLD ?? "0");
const alertThresholdDays = process.env.ALERT_THRESHOLD_DAYS
  ? Number(process.env.ALERT_THRESHOLD_DAYS)
  : undefined;
const alertUsersRaw = process.env.ALERT_USER_IDS;

if (!submissionId) {
  throw new Error("SUBMISSION_ID is required");
}

const requiredFields = requiredFieldsRaw
  ? (JSON.parse(requiredFieldsRaw) as string[])
  : [];
const fieldsSchema = fieldsSchemaRaw
  ? (JSON.parse(fieldsSchemaRaw) as Record<string, unknown>)
  : undefined;
const alertUsers = alertUsersRaw
  ? (alertUsersRaw.startsWith("[")
      ? (JSON.parse(alertUsersRaw) as string[])
      : alertUsersRaw.split(",").map((id) => id.trim()).filter(Boolean))
  : [];

const documentsConn = await connectMcp("MCP_DOCUMENTS");
const storageConn = await connectMcp("MCP_STORAGE");
const analysisConn = await connectMcp("MCP_DOCUMENT_ANALYSIS");
const nlpConn = await connectMcp("MCP_NLP");
const notificationsConn = await connectMcp("MCP_NOTIFICATIONS");
const auditConn = await connectMcp("MCP_AUDIT");

try {
  const piecesPayload = await callTool<unknown[]>(
    documentsConn.client,
    "list_pieces_admin",
    { submissionId }
  );
  const pieces = asArray(piecesPayload);

  for (const piece of pieces) {
    const document = piece.document as Record<string, unknown> | undefined;
    const documentId =
      (piece.documentId as string | undefined) ??
      (piece.document_id as string | undefined) ??
      (document?.id as string | undefined) ??
      (piece.id as string | undefined);
    if (!documentId) {
      continue;
    }

    const pieceId = (piece.pieceId as string | undefined) ??
      (piece.piece_id as string | undefined) ??
      (piece.id as string | undefined);

    const docRef = await callTool<Record<string, unknown> | string>(
      documentsConn.client,
      "get_document_url",
      { documentId }
    );

    let fileUrl: string | undefined;
    let storageKey: string | undefined;

    if (typeof docRef === "string") {
      fileUrl = docRef;
    } else if (docRef && typeof docRef === "object") {
      const record = docRef as Record<string, unknown>;
      fileUrl =
        (record.url as string | undefined) ??
        (record.fileUrl as string | undefined) ??
        (record.fichierUrl as string | undefined) ??
        (record.downloadUrl as string | undefined);
      storageKey =
        (record.storageKey as string | undefined) ??
        (record.objectKey as string | undefined);
    }

    if (!fileUrl && storageKey) {
      const presigned = await callTool<Record<string, unknown> | string>(
        storageConn.client,
        "get_presigned_url",
        { objectKey: storageKey }
      );
      if (typeof presigned === "string") {
        fileUrl = presigned;
      } else if (presigned && typeof presigned === "object") {
        fileUrl =
          (presigned as Record<string, unknown>).url as string | undefined;
      }
    }

    if (!fileUrl) {
      continue;
    }

    const extractTextResult = await callTool<Record<string, unknown>>(
      analysisConn.client,
      "extract_text",
      { fileUrl }
    );
    const extractedText = pickFirstText(extractTextResult);
    const confidence = pickNumber(extractTextResult);

    const extractFieldsResult = fieldsSchema
      ? await callTool<Record<string, unknown>>(
          analysisConn.client,
          "extract_fields",
          { fileUrl, schema: fieldsSchema }
        )
      : undefined;

    const completenessResult = extractedText
      ? await callTool<Record<string, unknown>>(
          nlpConn.client,
          "check_completeness",
          { text: extractedText, requiredFields }
        )
      : undefined;

    const expiryResult = extractedText
      ? await callTool<Record<string, unknown>>(
          nlpConn.client,
          "check_expiry_dates",
          {
            text: extractedText,
            alertThresholdDays,
          }
        )
      : undefined;

    const anomalies = {
      fields: extractFieldsResult,
      completeness: completenessResult,
      expiry: expiryResult,
    };

    await callTool(
      documentsConn.client,
      "write_ocr_result",
      {
        documentId,
        pieceId,
        typeAnalyse: "OCR_NLP",
        texteExtrait: extractedText,
        scoreConfiance: confidence,
        anomalies,
      }
    );

    const shouldAlert =
      typeof confidence === "number" && confidenceThreshold > 0
        ? confidence < confidenceThreshold
        : false;

    if (shouldAlert && alertUsers.length > 0) {
      await callTool(
        notificationsConn.client,
        "send_ai_alert",
        {
          titre: "OCR/NLP faible confiance",
          message: `Confiance OCR/NLP faible pour document ${documentId}.`,
          typeAlerte: "OCR_NLP",
          niveauUrgence: "MOYENNE",
          utilisateursCibles: alertUsers,
          entiteType: "document",
          entiteId: documentId,
          donneesContexte: { confidence },
        }
      );
    }
  }

  await callTool(auditConn.client, "log_ia_decision", {
    agentName: "ocr_nlp_agent",
    entite: "submission",
    entiteId: submissionId,
    action: "ocr_nlp_conformity",
    details: `Processed submission ${submissionId}`,
    horodatage: new Date().toISOString(),
  });
} finally {
  await closeAll([
    documentsConn,
    storageConn,
    analysisConn,
    nlpConn,
    notificationsConn,
    auditConn,
  ]);
}
