import { connectMcp, closeAll } from "../shared/mcpClient.js";
import { callTool, asArray } from "../shared/tooling.js";

const aoId = process.env.AO_ID;
const confidenceThreshold = Number(process.env.ANOMALY_ALERT_THRESHOLD ?? "0.75");
const relatedAoSetRaw = process.env.RELATED_AO_SET_JSON;

if (!aoId) {
  throw new Error("AO_ID is required");
}

const relatedAoSet = relatedAoSetRaw
  ? (JSON.parse(relatedAoSetRaw) as Array<Record<string, unknown>>)
  : undefined;

const soumissionsConn = await connectMcp("MCP_SOUMISSIONS");
const anomalyConn = await connectMcp("MCP_ANOMALY");
const auditConn = await connectMcp("MCP_AUDIT");

function severityForConfidence(confidence: number) {
  if (confidence >= 0.9) return "CRITIQUE";
  if (confidence >= confidenceThreshold) return "ELEVEE";
  if (confidence >= 0.5) return "MOYENNE";
  return "FAIBLE";
}

try {
  const soumissionsPayload = await callTool<unknown[]>(
    soumissionsConn.client,
    "list_soumissions",
    { aoId }
  );
  const soumissions = asArray(soumissionsPayload);

  const metadataList: Array<Record<string, unknown>> = [];
  for (const soumission of soumissions) {
    const soumissionId =
      (soumission.id as string | undefined) ??
      (soumission.soumissionId as string | undefined);
    if (!soumissionId) {
      continue;
    }
    const metadata = await callTool<Record<string, unknown>>(
      soumissionsConn.client,
      "get_metadata_soumission",
      { soumissionId }
    );
    if (metadata && typeof metadata === "object") {
      metadataList.push(metadata);
    }
  }

  const collusionResult = await callTool<Record<string, unknown>>(
    anomalyConn.client,
    "detect_collusion",
    { bids: metadataList }
  );

  const pricePatternResult = await callTool<Record<string, unknown>>(
    anomalyConn.client,
    "detect_price_pattern",
    { bids: metadataList }
  );

  const saucissonnageResult = relatedAoSet
    ? await callTool<Record<string, unknown>>(
        anomalyConn.client,
        "detect_saucissonnage",
        { aoSet: relatedAoSet }
      )
    : undefined;

  const results = [
    { type: "collusion", data: collusionResult },
    { type: "price_pattern", data: pricePatternResult },
    { type: "saucissonnage", data: saucissonnageResult },
  ];

  for (const result of results) {
    if (!result.data || typeof result.data !== "object") {
      continue;
    }
    const record = result.data as Record<string, unknown>;
    const flags =
      (record.flags as Array<Record<string, unknown>> | undefined) ??
      (record.flagged as Array<Record<string, unknown>> | undefined) ??
      [];

    for (const flag of flags) {
      const soumissionId =
        (flag.soumissionId as string | undefined) ??
        (flag.bidId as string | undefined) ??
        (flag.id as string | undefined);
      const confidence = flag.confidence as number | undefined;
      const detail =
        (flag.detail as string | undefined) ??
        (flag.reason as string | undefined) ??
        JSON.stringify(flag);

      if (!soumissionId || typeof confidence !== "number") {
        continue;
      }

      await callTool(soumissionsConn.client, "flag_anomaly", {
        soumissionId,
        anomalyType: result.type,
        detail,
        confidence,
      });

      await callTool(auditConn.client, "create_incident_ia", {
        typeIncident: "ANOMALIE_SOUMISSION",
        entiteSource: "soumissions",
        entiteId: soumissionId,
        modeleIa: "anomaly-agent",
        decisionIa: `${result.type}: ${detail}`,
        ecartScore: confidence,
        confianceIa: confidence,
        gravite: severityForConfidence(confidence),
        dateDetection: new Date().toISOString(),
      });
    }
  }

  await callTool(auditConn.client, "log_ia_decision", {
    agentName: "anomaly_detection_agent",
    entite: "appel_offre",
    entiteId: aoId,
    action: "anomaly_detection",
    details: "Completed anomaly detection workflow",
    horodatage: new Date().toISOString(),
  });
} finally {
  await closeAll([soumissionsConn, anomalyConn, auditConn]);
}
