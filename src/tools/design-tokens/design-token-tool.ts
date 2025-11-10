import {z} from "zod";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {FigmaService} from "../../services/figma.js";
import {
    extractDesignTokens,
    type DesignTokenExtractionResult,
    type DesignTokenModeValue
} from "../../extractors/design-tokens/index.js";

interface FormatOptions {
    limitPerCollection?: number;
}

export function registerDesignTokenTools(server: McpServer, figmaApiKey: string) {
    server.registerTool(
        "extract_design_tokens",
        {
            title: "Extract Design Tokens (Variables)",
            description: "Extract Figma design tokens (Variables API) including collections, modes, alias resolution, and formatted values.",
            inputSchema: {
                fileId: z.string().describe("Figma file ID"),
                resolveAliases: z.boolean().optional().describe("Resolve alias values to their concrete values when possible (default: true)"),
                limitPerCollection: z.number().optional().describe("Maximum number of tokens to show per collection in the textual summary (default: 12)")
            }
        },
        async ({fileId, resolveAliases = true, limitPerCollection = 12}) => {
            if (!figmaApiKey) {
                return {
                    content: [{
                        type: "text",
                        text: "Error: Figma access token not configured. Please set FIGMA_API_KEY environment variable."
                    }]
                };
            }

            try {
                const figmaService = new FigmaService(figmaApiKey);
                const meta = await figmaService.getLocalVariables(fileId);

                if (!meta.variables || meta.variables.length === 0) {
                    return {
                        content: [{
                            type: "text",
                            text: `No design tokens found in file ${fileId}. Make sure Variables are defined and that your token has the Variables scope enabled.`
                        }]
                    };
                }

                const extraction = extractDesignTokens(meta, {resolveAliases});
                const summary = formatDesignTokenSummary(fileId, extraction, {
                    limitPerCollection
                });
                const jsonBlock = JSON.stringify(extraction, null, 2);

                return {
                    content: [{
                        type: "text",
                        text: `${summary}\n\nJSON Payload:\n\`\`\`json\n${jsonBlock}\n\`\`\`\n`
                    }]
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    content: [{
                        type: "text",
                        text: `Error extracting design tokens: ${message}`
                    }]
                };
            }
        }
    );
}

function formatDesignTokenSummary(
    fileId: string,
    result: DesignTokenExtractionResult,
    options: FormatOptions
): string {
    const scopes = result.scopes.length > 0 ? result.scopes.join(", ") : "None";

    let output = `🎯 Design Token Extraction\n`;
    output += `File: ${fileId}\n`;
    output += `Scopes: ${scopes}\n`;
    output += `Collections: ${result.collections.length}\n`;
    output += `Tokens: ${result.tokens.length}\n\n`;

    const limit = options.limitPerCollection ?? 12;

    result.collections.forEach(collection => {
        output += `📚 Collection: ${collection.name}\n`;
        output += `  • ID: ${collection.id}\n`;
        output += `  • Modes: ${collection.modeCount}\n`;
        output += `  • Tokens: ${collection.tokenCount}\n`;
        if (collection.description) {
            output += `  • Description: ${collection.description}\n`;
        }
        output += `\n`;

        const tokensInCollection = result.tokens.filter(token => token.collection.id === collection.id);
        const limitedTokens = tokensInCollection.slice(0, limit);

        limitedTokens.forEach(token => {
            output += `  ▸ ${token.name} (${token.type})\n`;
            if (token.description) {
                output += `    - ${token.description}\n`;
            }

            const valueSummary = token.values
                .map(modeValue => formatModeValue(modeValue))
                .join("; ");

            output += `    - ${valueSummary}\n`;
        });

        if (tokensInCollection.length > limit) {
            output += `  … ${tokensInCollection.length - limit} more tokens (see JSON payload)\n`;
        }

        output += `\n`;
    });

    if (result.tokens.length === 0) {
        output += `No tokens extracted. Ensure Variables are defined in the Figma file and accessible.\n`;
    }

    return output.trimEnd();
}

function formatModeValue(modeValue: DesignTokenModeValue): string {
    const modeLabel = modeValue.modeName || modeValue.modeId;

    if (modeValue.aliasOf) {
        const aliasName = modeValue.aliasOf.name || modeValue.aliasOf.id;
        const resolved = formatResolvedValue(modeValue);
        return `${modeLabel}: ↪ ${aliasName}${resolved ? ` (${resolved})` : ''}`;
    }

    const resolved = formatResolvedValue(modeValue);
    return `${modeLabel}: ${resolved ?? '—'}`;
}

function formatResolvedValue(modeValue: DesignTokenModeValue): string | null {
    if (modeValue.value === null || modeValue.value === undefined) {
        return null;
    }

    if (typeof modeValue.value === "string") {
        if (modeValue.hex && modeValue.value.startsWith("#")) {
            return modeValue.hex;
        }
        return modeValue.value;
    }

    if (typeof modeValue.value === "number" || typeof modeValue.value === "boolean") {
        return String(modeValue.value);
    }

    if (modeValue.hex) {
        return modeValue.hex;
    }

    if (modeValue.rgba) {
        return modeValue.rgba;
    }

    return JSON.stringify(modeValue.value);
}

