const requiredSections = [
  "User Request",
  "Current Decision To Review",
  "Visible Session Context",
  "Evidence Inventory",
  "Source Manifest",
  "Relevant Artifacts",
  "Constraints And Requirements",
  "Claude Decision Rationale",
  "Alternatives Considered",
  "Known Uncertainty",
  "Review Focus",
] as const;

export interface PacketQuality {
  score: number;
  bytes: number;
  sectionsPresent: number;
  sectionsRequired: number;
  sourceIds: number;
  sourceReferences: number;
  issues: string[];
}

export function analyzePacketQuality(packet: string): PacketQuality {
  const headings = new Set([...packet.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((match) => match[1].trim().toLowerCase()));
  const missing = requiredSections.filter((section) => !headings.has(section.toLowerCase()));
  const sourceMatches = [...packet.matchAll(/\bS\d+\b/gi)].map((match) => match[0].toUpperCase());
  const sources = new Set(sourceMatches);
  const sourceReferences = Math.max(0, sourceMatches.length - sources.size);
  const issues: string[] = [];
  if (missing.length) issues.push(`Missing sections: ${missing.join(", ")}.`);
  if (!sources.size) issues.push("No stable source IDs were found.");
  else if (!sourceReferences) issues.push("Source IDs are listed but never cited again in the packet.");
  if (Buffer.byteLength(packet, "utf8") < 800) issues.push("The transferred context is unusually short.");
  const sectionPoints = Math.round(((requiredSections.length - missing.length) / requiredSections.length) * 60);
  const sourcePoints = Math.min(20, sources.size * 4);
  const referencePoints = Math.min(20, sourceReferences * 2);
  return {
    score: Math.max(0, Math.min(100, sectionPoints + sourcePoints + referencePoints)),
    bytes: Buffer.byteLength(packet, "utf8"),
    sectionsPresent: requiredSections.length - missing.length,
    sectionsRequired: requiredSections.length,
    sourceIds: sources.size,
    sourceReferences,
    issues,
  };
}
