import type {
    FigmaVariableResolvedType,
    FigmaVariableValue
} from '../../types/figma.js';

export type DesignTokenType = 'color' | 'number' | 'string' | 'boolean';

export interface DesignTokenAliasInfo {
    id: string;
    name?: string;
    type?: DesignTokenType;
}

export interface DesignTokenModeValue {
    modeId: string;
    modeName: string;
    raw: FigmaVariableValue;
    value: string | number | boolean | null;
    hex?: string;
    rgba?: string;
    aliasOf?: DesignTokenAliasInfo;
}

export interface DesignTokenCollectionRef {
    id: string;
    name: string;
    defaultModeId: string;
    modeCount: number;
}

export interface DesignToken {
    id: string;
    key: string;
    name: string;
    description?: string;
    type: DesignTokenType;
    resolvedType: FigmaVariableResolvedType;
    remote: boolean;
    collection: DesignTokenCollectionRef;
    scopes?: string[];
    values: DesignTokenModeValue[];
}

export interface DesignTokenCollectionSummary extends DesignTokenCollectionRef {
    tokenCount: number;
    description?: string;
    remote: boolean;
}

export interface DesignTokenExtractionOptions {
    /**
     * Resolve alias values to their concrete values when possible.
     * Defaults to true.
     */
    resolveAliases?: boolean;
}

export interface DesignTokenExtractionResult {
    scopes: string[];
    collections: DesignTokenCollectionSummary[];
    tokens: DesignToken[];
}

