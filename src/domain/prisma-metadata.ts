export type Field = {
  name: string;
  kind: "scalar" | "object" | "enum" | "unsupported";
  type: string;
  enumValues?: string[];
  isList: boolean;
  isRequired: boolean;
};

export type Model = {
  name: string;
  fields: Field[];
};
