from google import genai
import os

# 1. Setup Client
api_key = os.environ.get("GEMINI_API_KEY")
if not api_key:
    print("Error: GEMINI_API_KEY environment variable not found.")
    exit()

client = genai.Client(api_key=api_key)

print(f"{'Model Name':<50} | {'Input Limit':<12} | {'Output Limit':<12}")
print("-" * 80)

try:
    # 2. Loop through all models
    for model in client.models.list():
        
        # 3. Safe Extraction: Use getattr to avoid crashes if a field is missing
        # We also treat the limits as 0 if they are None (common for some system models)
        in_limit = getattr(model, 'input_token_limit', 0)
        out_limit = getattr(model, 'output_token_limit', 0)
        
        # Format for readability
        in_str = f"{in_limit:,}" if in_limit else "-"
        out_str = f"{out_limit:,}" if out_limit else "-"

        # 4. Print every model
        print(f"{model.name:<50} | {in_str:<12} | {out_str:<12}")

except Exception as e:
    print(f"\nError: {e}")