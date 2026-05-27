export type PrismaFieldMetadata = {
  name: string;
  kind: "scalar" | "object" | "enum" | "unsupported";
  type: string;
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
  const models = findRuntimeModels(client);

  if (!models) {
    throw new MetadataError(
      "Could not discover Prisma model metadata from the generated Prisma Client.",
    );
  }

  return {
    models: models
      .map(normalizeModel)
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function findRuntimeModels(client: unknown): RuntimeModel[] | undefined {
  const runtimeDataModel = readObjectPath(client, ["_runtimeDataModel", "models"]);
  const runtimeModels = modelsFromUnknown(runtimeDataModel);
  if (runtimeModels) return runtimeModels;

  const dmmfModels = readObjectPath(client, ["_dmmf", "datamodel", "models"]);
  return modelsFromUnknown(dmmfModels);
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

function normalizeModel(model: RuntimeModel): PrismaModelMetadata {
  if (typeof model.name !== "string" || model.name.length === 0) {
    throw new MetadataError("Prisma metadata contained a model without a valid name.");
  }

  const modelName = model.name;

  if (!Array.isArray(model.fields)) {
    throw new MetadataError(`Prisma metadata for model ${modelName} did not include fields.`);
  }

  return {
    name: modelName,
    fields: model.fields.map((field) => normalizeField(modelName, field)),
  };
}

function normalizeField(modelName: string, field: unknown): PrismaFieldMetadata {
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

  return {
    name: runtimeField.name,
    kind: normalizeKind(modelName, runtimeField),
    type: runtimeField.type,
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
