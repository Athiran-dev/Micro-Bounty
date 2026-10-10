import { callOpenRouter } from './openrouter';

export type DocuMindOutput = {
  summary: string;
  key_findings: string[];
  methodology: string;
  technical_concepts: { term: string; explanation: string }[];
  citations_count: number;
  key_citations: string[];
  eli5: string;
  confidence_score: number;
  pages_analyzed: number;
};

export type AuditorOutput = {
  security_grade: 'A' | 'B' | 'C' | 'F';
  overall_risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  vulnerabilities: {
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    type: string;
    location: string;
    description: string;
    fix: string;
  }[];
  gas_optimizations: {
    impact: 'LOW' | 'MEDIUM' | 'HIGH';
    suggestion: string;
    estimated_savings: string;
  }[];
  positive_findings: string[];
  summary: string;
  audit_lines: number;
  confidence_score: number;
};

export async function simulateDocuMind(input: string): Promise<DocuMindOutput> {
  const prompt = `Analyze this research paper/text and return structured JSON with:
  {
    "summary": "2-3 sentence TL;DR of the paper",
    "key_findings": ["Finding 1", "Finding 2", "Finding 3", "Finding 4", "Finding 5"],
    "methodology": "How the research was conducted in plain English",
    "technical_concepts": [
      { "term": "Term name", "explanation": "ELI5 explanation" },
      { "term": "Term name", "explanation": "ELI5 explanation" },
      { "term": "Term name", "explanation": "ELI5 explanation" }
    ],
    "eli5": "Explain this paper like I'm 10 years old — 2-3 fun sentences",
    "citations_count": number,
    "key_citations": ["Author et al. (2023)...", "..."],
    "confidence_score": number (0-100),
    "pages_analyzed": number
  }
  Text: ${input}
  Return ONLY valid JSON, no markdown.`;

  const response = await callOpenRouter('openai/gpt-4o-mini', prompt);
  
  // Clean markdown blocks if present
  let cleanResponse = response.trim();
  if (cleanResponse.startsWith('```json')) {
    cleanResponse = cleanResponse.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
  } else if (cleanResponse.startsWith('```')) {
    cleanResponse = cleanResponse.replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
  }
  
  return JSON.parse(cleanResponse);
}

export async function simulateAuditor(code: string, language: string): Promise<AuditorOutput> {
  const prompt = `You are a senior Web3 security auditor. Analyze this ${language} smart contract code and return structured JSON:
  {
    "security_grade": "A/B/C/F",
    "overall_risk": "LOW/MEDIUM/HIGH/CRITICAL",
    "vulnerabilities": [
      {
        "severity": "LOW/MEDIUM/HIGH/CRITICAL",
        "type": "Name of vulnerability",
        "location": "Line number and function name",
        "description": "Short description",
        "fix": "How to fix it"
      }
    ],
    "gas_optimizations": [
      {
        "impact": "LOW/MEDIUM/HIGH",
        "suggestion": "Suggestion text",
        "estimated_savings": "e.g. ~0.3 ALGO"
      }
    ],
    "positive_findings": ["string"],
    "summary": "Overall summary of the audit",
    "audit_lines": number,
    "confidence_score": number (0-100)
  }
  Code: ${code}
  Return ONLY valid JSON, no markdown.`;

  const response = await callOpenRouter('openai/gpt-4o-mini', prompt);
  
  // Clean markdown blocks if present
  let cleanResponse = response.trim();
  if (cleanResponse.startsWith('```json')) {
    cleanResponse = cleanResponse.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
  } else if (cleanResponse.startsWith('```')) {
    cleanResponse = cleanResponse.replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
  }
  
  return JSON.parse(cleanResponse);
}
