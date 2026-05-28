export type PrismaFieldMetadata = {
  name: string;
  kind: "scalar" | "object" | "enum" | "unsupported";
  type: string;
  enumValues: string[];
  isList: boolean;
  isRequired: boolean;
  isUnique: boolean;
  isId: boolean;
  hasDefaultValue: boolean;
  relationName: string | null;
};

export type PrismaModelMetadata = {
  name: string;
  fields: PrismaFieldMetadata[];
};

export type PrismaMetadata = {
  models: PrismaModelMetadata[];
};

type RuntimeModel = {
  name?: unknown;
  fields?: unknown;
};

type RuntimeEnum = {
  name?: unknown;
  values?: unknown;
};

type RuntimeField = {
  name?: unknown;
  kind?: unknown;
  type?: unknown;
  isList?: unknown;
  isRequired?: unknown;
  isUnique?: unknown;
  isId?: unknown;
  hasDefaultValue?: unknown;
  relationName?: unknown;
};

export class MetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetadataError";
  }
}

export function discoverPrismaMetadata(client: unknown): PrismaMetadata {
  const metadata = findRuntimeMetadata(client);

  if (!metadata) {
    throw new MetadataError(
      "Could not discover Prisma model metadata from the generated Prisma Client.",
    );
  }

  return {
    models: metadata.models
      .map((model) => normalizeModel(model, metadata.enumsByName))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function findRuntimeMetadata(
  client: unknown,
): { models: RuntimeModel[]; enumsByName: Map<string, string[]> } | undefined {
  const runtimeDataModel = readObjectPath(client, ["_runtimeDataModel", "models"]);
  const runtimeModels = modelsFromUnknown(runtimeDataModel);
  if (runtimeModels) {
    return {
      models: runtimeModels,
      enumsByName: enumsByNameFromUnknown(
        readObjectPath(client, ["_runtimeDataModel", "enums"]),
      ),
    };
  }

  const dmmfModels = readObjectPath(client, ["_dmmf", "datamodel", "models"]);
  const models = modelsFromUnknown(dmmfModels);
  if (!models) return undefined;

  return {
    models,
    enumsByName: enumsByNameFromUnknown(
      readObjectPath(client, ["_dmmf", "datamodel", "enums"]),
    ),
  };
}

function modelsFromUnknown(value: unknown): RuntimeModel[] | undefined {
  if (Array.isArray(value)) return value as RuntimeModel[];

  if (isRecord(value)) {
    return Object.entries(value).map(([modelName, model]) => {
      if (!isRecord(model) || typeof model.name === "string") {
        return model as RuntimeModel;
      }

      return { ...model, name: modelName } as RuntimeModel;
    });
  }

  return undefined;
}

function enumsByNameFromUnknown(value: unknown) {
  const enums = enumsFromUnknown(value);
  const enumsByName = new Map<string, string[]>();
  for (const item of enums) {
    if (typeof item.name !== "string" || item.name.length === 0) continue;
    enumsByName.set(item.name, normalizeEnumValues(item.values));
  }
  return enumsByName;
}

function enumsFromUnknown(value: unknown): RuntimeEnum[] {
  if (Array.isArray(value)) return value as RuntimeEnum[];

  if (isRecord(value)) {
    return Object.entries(value).map(([enumName, enumValue]) => {
      if (Array.isArray(enumValue)) {
        return { name: enumName, values: enumValue };
      }

      if (!isRecord(enumValue)) {
        return { name: enumName, values: enumValue };
      }

      return {
        ...enumValue,
        name: typeof enumValue.name === "string" ? enumValue.name : enumName,
      } as RuntimeEnum;
    });
  }

  return [];
}

function normalizeEnumValues(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (typeof item === "string" && item.length > 0) return [item];
    if (isRecord(item) && typeof item.name === "string" && item.name.length > 0) {
      return [item.name];
    }
    return [];
  });
}

function normalizeModel(
  model: RuntimeModel,
  enumsByName: Map<string, string[]>,
): PrismaModelMetadata {
  if (typeof model.name !== "string" || model.name.length === 0) {
    throw new MetadataError("Prisma metadata contained a model without a valid name.");
  }

  const modelName = model.name;

  if (!Array.isArray(model.fields)) {
    throw new MetadataError(`Prisma metadata for model ${modelName} did not include fields.`);
  }

  return {
    name: modelName,
    fields: model.fields.map((field) => normalizeField(modelName, field, enumsByName)),
  };
}

function normalizeField(
  modelName: string,
  field: unknown,
  enumsByName: Map<string, string[]>,
): PrismaFieldMetadata {
  if (!isRecord(field)) {
    throw new MetadataError(
      `Prisma metadata for model ${modelName} contained an invalid field.`,
    );
  }

  const runtimeField = field as RuntimeField;

  if (typeof runtimeField.name !== "string" || runtimeField.name.length === 0) {
    throw new MetadataError(
      `Prisma metadata for model ${modelName} contained a field without a valid name.`,
    );
  }

  if (typeof runtimeField.type !== "string" || runtimeField.type.length === 0) {
    throw new MetadataError(
      `Prisma metadata for field ${modelName}.${runtimeField.name} did not include a valid type.`,
    );
  }

  const kind = normalizeKind(modelName, runtimeField);

  return {
    name: runtimeField.name,
    kind,
    type: runtimeField.type,
    enumValues: kind === "enum" ? (enumsByName.get(runtimeField.type) ?? []) : [],
    isList: runtimeField.isList === true,
    isRequired: runtimeField.isRequired === true,
    isUnique: runtimeField.isUnique === true,
    isId: runtimeField.isId === true,
    hasDefaultValue: runtimeField.hasDefaultValue === true,
    relationName:
      typeof runtimeField.relationName === "string" && runtimeField.relationName.length > 0
        ? runtimeField.relationName
        : null,
  };
}

function normalizeKind(modelName: string, field: RuntimeField): PrismaFieldMetadata["kind"] {
  if (
    field.kind === "scalar" ||
    field.kind === "object" ||
    field.kind === "enum" ||
    field.kind === "unsupported"
  ) {
    return field.kind;
  }

  throw new MetadataError(
    `Prisma metadata for field ${modelName}.${String(field.name)} had an unsupported kind.`,
  );
}

function readObjectPath(value: unknown, path: string[]) {
  let current = value;

  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }

  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
