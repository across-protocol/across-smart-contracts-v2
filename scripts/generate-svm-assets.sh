#!/bin/bash

# Set paths for source and destination
TARGET_IDL="./target/idl"
TARGET_TYPES="./target/types"
SVM_ASSETS="./src/svm/assets"
SVM_IDL="$SVM_ASSETS/idl"
SVM_TYPES="$SVM_ASSETS"
IDL_OUTPUT_FILE="$SVM_IDL/index.ts"
TYPES_OUTPUT_FILE="$SVM_TYPES/index.ts"

# Ensure the destination directories exist
mkdir -p "$SVM_IDL"
mkdir -p "$SVM_TYPES"

# --- Copy Files ---
echo "Copying IDL files..."
cp -r "$TARGET_IDL/"* "$SVM_IDL/"

echo "Copying Types files..."
cp -r "$TARGET_TYPES/"* "$SVM_TYPES/"

# --- Generate IDL index.ts ---
echo "Generating IDL index.ts..."
> "$IDL_OUTPUT_FILE"

# Add autogenerated file note
{
  echo "// This file has been autogenerated. Do not edit manually."
  echo "// Generated by a script."
  echo
} >> "$IDL_OUTPUT_FILE"

IMPORTS=""
EXPORTS=""

for file in "$SVM_IDL"/*.json; do
  filename=$(basename -- "$file")
  name="${filename%.json}"
  camelCaseName=$(echo "$name" | awk -F'_' '{
    for (i=1; i<=NF; i++) {
      printf toupper(substr($i,1,1)) tolower(substr($i,2));
    }
  }')
  IMPORTS="${IMPORTS}const ${camelCaseName}Idl = require(\"./${filename}\");\n"
  EXPORTS="${EXPORTS}  ${camelCaseName}Idl,\n"
done

# Write the imports to the file
printf "$IMPORTS" >> "$IDL_OUTPUT_FILE"

# Write the exports block
{
  echo "export {"
  printf "$EXPORTS" | sed '$ s/,$//'
  echo "};"
} >> "$IDL_OUTPUT_FILE"

echo "IDL index.ts generated successfully at $IDL_OUTPUT_FILE"

# --- Generate svm-types index.ts ---
echo "Generating svm-types index.ts..."
> "$TYPES_OUTPUT_FILE"

# Add autogenerated file note
{
  echo "// This file has been autogenerated. Do not edit manually."
  echo "// Generated by a script."
  echo
} >> "$TYPES_OUTPUT_FILE"

# Export * from ./idl
echo "export * from \"./idl\";" >> "$TYPES_OUTPUT_FILE"

# Export * from each .ts file in ./svm-types, removing underscores and capitalizing names
for file in "$SVM_TYPES"/*.ts; do
  [ "$(basename -- "$file")" = "index.ts" ] && continue
  filename=$(basename -- "$file")
  name="${filename%.ts}"
  camelCaseName=$(echo "$name" | awk -F'_' '{
    for (i=1; i<=NF; i++) {
      printf toupper(substr($i,1,1)) tolower(substr($i,2));
    }
  }')
  newName="${camelCaseName}Anchor"
  echo "export {${camelCaseName} as ${newName}} from \"./${name}\";" >> "$TYPES_OUTPUT_FILE"
done

echo "svm-types index.ts generated successfully at $TYPES_OUTPUT_FILE"