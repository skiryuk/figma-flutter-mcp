import {
    type FigmaVariable,
    type FigmaVariableAlias,
    type FigmaVariableCollection,
    type FigmaVariableValue,
    type FigmaVariablesMeta
} from '../../types/figma.js';
import {
    type DesignToken,
    type DesignTokenCollectionSummary,
    type DesignTokenExtractionOptions,
    type DesignTokenExtractionResult,
    type DesignTokenModeValue,
    type DesignTokenType
} from './types.js';

const VARIABLE_TYPE_MAP: Record<string, DesignTokenType> = {
    COLOR: 'color',
    FLOAT: 'number',
    STRING: 'string',
    BOOLEAN: 'boolean'
};

type FormattedPrimitiveValue = {
    value: string | number | boolean | null;
    hex?: string;
    rgba?: string;
};

export class DesignTokenExtractor {
    private readonly meta: FigmaVariablesMeta;
    private readonly collectionMap = new Map<string, FigmaVariableCollection>();
    private readonly variableMap = new Map<string, FigmaVariable>();
    private readonly modeNameMap = new Map<string, Record<string, string>>();

    constructor(meta: FigmaVariablesMeta) {
        this.meta = meta;

        meta.variableCollections.forEach(collection => {
            this.collectionMap.set(collection.id, collection);
            const modeMap: Record<string, string> = {};
            collection.modes?.forEach(mode => {
                modeMap[mode.modeId] = mode.name;
            });
            this.modeNameMap.set(collection.id, modeMap);
        });

        meta.variables.forEach(variable => {
            this.variableMap.set(variable.id, variable);
        });
    }

    extract(options: DesignTokenExtractionOptions = {}): DesignTokenExtractionResult {
        const resolveAliases = options.resolveAliases ?? true;
        const tokens = this.meta.variables.map(variable => this.createToken(variable, resolveAliases));
        const collections = this.buildCollectionSummaries(tokens);

        return {
            scopes: [...(this.meta.scopes || [])],
            collections,
            tokens
        };
    }

    private createToken(variable: FigmaVariable, resolveAliases: boolean): DesignToken {
        const collection = this.collectionMap.get(variable.variableCollectionId);
        const collectionRef = {
            id: collection?.id ?? variable.variableCollectionId,
            name: collection?.name ?? 'Unknown Collection',
            defaultModeId: collection?.defaultModeId ?? '',
            modeCount: collection?.modes?.length ?? Object.keys(variable.valuesByMode ?? {}).length
        };

        const designTokenType = VARIABLE_TYPE_MAP[variable.resolvedType] ?? 'string';
        const modeIds = this.collectModeIds(collection, variable);

        const values: DesignTokenModeValue[] = modeIds.map(modeId => {
            const modeName = this.getModeName(collection, modeId);
            const raw = this.getRawValue(variable, modeId);
            const processed = this.processValue(variable, raw, modeId, resolveAliases);

            return {
                modeId,
                modeName,
                raw,
                value: processed.value,
                hex: processed.hex,
                rgba: processed.rgba,
                aliasOf: processed.aliasOf
            };
        });

        return {
            id: variable.id,
            key: variable.key,
            name: variable.name,
            description: variable.description,
            type: designTokenType,
            resolvedType: variable.resolvedType,
            remote: Boolean(variable.remote),
            collection: collectionRef,
            scopes: variable.scopes,
            values
        };
    }

    private collectModeIds(collection: FigmaVariableCollection | undefined, variable: FigmaVariable): string[] {
        const modeIds = new Set<string>();
        if (collection?.modes) {
            collection.modes.forEach(mode => modeIds.add(mode.modeId));
        }

        Object.keys(variable.valuesByMode || {}).forEach(modeId => modeIds.add(modeId));

        return Array.from(modeIds);
    }

    private getModeName(collection: FigmaVariableCollection | undefined, modeId: string): string {
        if (!collection) {
            return modeId;
        }
        const modeLookup = this.modeNameMap.get(collection.id);
        return modeLookup?.[modeId] || modeId;
    }

    private getRawValue(variable: FigmaVariable, modeId: string): FigmaVariableValue {
        const directValue = variable.valuesByMode?.[modeId];
        if (directValue !== undefined) {
            return directValue;
        }

        const collection = this.collectionMap.get(variable.variableCollectionId);
        if (collection) {
            const defaultModeValue = variable.valuesByMode?.[collection.defaultModeId];
            if (defaultModeValue !== undefined) {
                return defaultModeValue;
            }
        }

        const firstValue = Object.values(variable.valuesByMode || {})[0];
        return firstValue ?? null;
    }

    private processValue(
        variable: FigmaVariable,
        rawValue: FigmaVariableValue,
        modeId: string,
        resolveAliases: boolean
    ): {
        value: string | number | boolean | null;
        hex?: string;
        rgba?: string;
        aliasOf?: DesignTokenModeValue['aliasOf'];
    } {
        if (rawValue === null || rawValue === undefined) {
            return {value: null};
        }

        if (this.isAlias(rawValue)) {
            const aliasInfo = {
                id: rawValue.id,
                name: this.variableMap.get(rawValue.id)?.name,
                type: VARIABLE_TYPE_MAP[this.variableMap.get(rawValue.id)?.resolvedType ?? ''] as DesignTokenType | undefined
            };

            let resolvedValue: FormattedPrimitiveValue | null = null;
            if (resolveAliases) {
                resolvedValue = this.resolveAlias(rawValue, modeId, new Set([variable.id]));
            }

            return {
                value: resolvedValue?.value ?? null,
                hex: resolvedValue?.hex,
                rgba: resolvedValue?.rgba,
                aliasOf: aliasInfo
            };
        }

        const formatted = this.formatPrimitiveValue(variable, rawValue);
        return formatted ?? {value: null};
    }

    private resolveAlias(
        alias: FigmaVariableAlias,
        modeId: string,
        visited: Set<string>
    ): FormattedPrimitiveValue | null {
        if (visited.has(alias.id)) {
            return null;
        }

        const variable = this.variableMap.get(alias.id);
        if (!variable) {
            return null;
        }

        visited.add(alias.id);

        const value = this.getRawValue(variable, modeId);
        if (value === null || value === undefined) {
            return {value: null};
        }

        if (this.isAlias(value)) {
            return this.resolveAlias(value, modeId, visited);
        }

        return this.formatPrimitiveValue(variable, value);
    }

    private formatPrimitiveValue(
        variable: FigmaVariable,
        value: Exclude<FigmaVariableValue, FigmaVariableAlias | null>
    ): FormattedPrimitiveValue | null {
        const designTokenType = VARIABLE_TYPE_MAP[variable.resolvedType] ?? 'string';

        switch (designTokenType) {
            case 'color':
                if (this.isColor(value)) {
                    const hex = this.colorToHex(value);
                    const rgba = this.colorToRgba(value);
                    return {
                        value: hex,
                        hex,
                        rgba
                    };
                }
                break;
            case 'number':
                if (typeof value === 'number') {
                    return {value};
                }
                break;
            case 'boolean':
                if (typeof value === 'boolean') {
                    return {value};
                }
                break;
            case 'string':
                if (typeof value === 'string') {
                    return {value};
                }
                break;
        }

        // Fallback to string representation
        if (typeof value === 'object') {
            return {value: JSON.stringify(value)};
        }

        if (value === undefined) {
            return {value: null};
        }

        return {value: value as any};
    }

    private buildCollectionSummaries(tokens: DesignToken[]): DesignTokenCollectionSummary[] {
        const summaryMap = new Map<string, DesignTokenCollectionSummary>();

        this.meta.variableCollections.forEach(collection => {
            summaryMap.set(collection.id, {
                id: collection.id,
                name: collection.name,
                defaultModeId: collection.defaultModeId,
                modeCount: collection.modes?.length ?? 0,
                tokenCount: 0,
                description: collection.description,
                remote: Boolean(collection.remote)
            });
        });

        tokens.forEach(token => {
            const existing = summaryMap.get(token.collection.id);
            if (existing) {
                existing.tokenCount += 1;
            } else {
                summaryMap.set(token.collection.id, {
                    id: token.collection.id,
                    name: token.collection.name,
                    defaultModeId: token.collection.defaultModeId,
                    modeCount: token.collection.modeCount,
                    tokenCount: 1,
                    remote: token.remote
                });
            }
        });

        return Array.from(summaryMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    }

    private isAlias(value: FigmaVariableValue): value is FigmaVariableAlias {
        return Boolean(value && typeof value === 'object' && 'type' in value && value.type === 'VARIABLE_ALIAS');
    }

    private isColor(value: FigmaVariableValue): value is {r: number; g: number; b: number; a: number} {
        return Boolean(
            value &&
            typeof value === 'object' &&
            'r' in value &&
            'g' in value &&
            'b' in value &&
            'a' in value
        );
    }

    private colorToHex(color: {r: number; g: number; b: number; a: number}): string {
        const r = Math.round(color.r * 255);
        const g = Math.round(color.g * 255);
        const b = Math.round(color.b * 255);
        const a = Math.round(color.a * 255);

        const rgbHex = [r, g, b].map(comp => comp.toString(16).padStart(2, '0')).join('').toUpperCase();
        if (a === 255) {
            return `#${rgbHex}`;
        }

        return `#${rgbHex}${a.toString(16).padStart(2, '0').toUpperCase()}`;
    }

    private colorToRgba(color: {r: number; g: number; b: number; a: number}): string {
        const r = Math.round(color.r * 255);
        const g = Math.round(color.g * 255);
        const b = Math.round(color.b * 255);
        const alpha = Number(color.a.toFixed(3));
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
}

export function extractDesignTokens(
    meta: FigmaVariablesMeta,
    options: DesignTokenExtractionOptions = {}
): DesignTokenExtractionResult {
    const extractor = new DesignTokenExtractor(meta);
    return extractor.extract(options);
}

