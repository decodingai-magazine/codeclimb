---
title: 'Structure Outputs: The Silent Hero of Production AI'
type: rss
published: '2025-10-14T00:00:00+00:00'
length: '3480'
source: decodingai-paul
source_id: 01k7hxd5a6xws4krg23gjxebv2
source_url: https://www.decodingai.com/p/llm-structured-outputs-the-only-way
author: Paul Iusztin
site_name: Decoding AI Magazine
category: rss
location: feed
tags: []
summary: Structured outputs force LLM responses into a predictable format like JSON
  or Pydantic. This makes parsing, validation, and orchestration reliable and prevents
  bad data from spreading. Using Pydantic or native API features (Gemini/OpenAI) gives
  automatic schemas and runtime validation for safer AI apps.
saved_at: '2025-10-14T17:48:32.015000+00:00'
updated_at: '2025-10-14T18:58:54.606257+00:00'
reading_time: 14 mins
---

***Welcome to AI Agents Foundations**—an 8-part journey from Python developer to AI Engineer.*

Everyone’s talking about AI agents. But what actually is an agent? When do we need them? How do they plan and use tools? How do we pick the correct AI tools and agentic architecture? …and most importantly, where do we even start?

To answer all these questions (and more!), We’ve started an 8-article, straight-to-the-point series for busy people who want to build the skills and mental models needed to ship real AI agents in production.

Providing you with all the building blocks that teach you *“how to fish”*.

**Everything is packed into a clear roadmap:**

1. [Workflows vs. Agents](https://decodingml.substack.com/p/ai-workflows-vs-agents-the-autonomy)
2. **Structured Outputs** ← *You are here*
3. Workflow Patterns ← *(available next Tuesday, 9:00 am CET)*
4. Tools
5. Planning: ReAct & Plan-and-Execute
6. Writing ReAct From Scratch
7. Memory
8. Multimodal Data

By the end, you’ll have a deep understanding of how to design from scratch agents that think, plan, and execute—and most importantly, how to integrate them in your AI apps without being overly reliant on any AI framework.

**Enjoy, and let’s get started!**

---

## Structured Outputs

In a recent project I am working on, our production AI system crashed right before an important demo. Why? Because we were not using structured outputs consistently across our Large Language Model (LLM) workflows.

Our staging environment had been working fine with simple regex parsing of LLM responses, but when we deployed to production, everything fell apart. Our regex patterns failed to match slightly different response formats, data types were inconsistent, and downstream processes couldn’t handle the unpredictable data, causing cascading failures. When demo day arrived, our system was completely unusable.

**The problem was clear:** we had been relying on fragile string parsing, hoping the LLM would always respond in the exact same format. But in production, especially with AI systems, users will always enter inputs you never expect. Without structured outputs, we had no data validation, no type checking, and no real control over how the output should look. Just like lock files ensure consistent dependencies, structured outputs ensure consistent AI data contracts by defining the expected structure for LLM responses.

In our previous article from the AI Agents Foundations series, we explored the difference between workflows and agents. Now, we will tackle a fundamental challenge: getting reliable information *out* of an LLM.

*To understand exactly what happens, we will first write everything from scratch and then move to using popular LLM APIs such as Gemini’s GenAI SDK:*

1. From scratch using JSON
2. From scratch using Pydantic *(We love Pydantic!)*
3. Using the Gemini SDK and Pydantic

## Understanding why structured outputs are important

Before we start coding, it is important to understand why structured outputs are foundational to building reliable AI applications. When an LLM returns a free-form string, you face the messy task of parsing it. This often involves fragile regular expressions or string-splitting logic that can easily break if the model outputs change slightly [[1]](https://pmc.ncbi.nlm.nih.gov/articles/PMC11751965/), [[2]](https://arxiv.org/html/2506.21585v1). Structured outputs solve this by forcing the model’s response into a predictable format like JSON or Pydantic.

This approach offers several key benefits. First, structured outputs are easy to parse and manipulate programmatically. Instead of wrestling with raw text, you work with clean Python objects, making your code more predictable and easier to debug. Using libraries like Pydantic adds a layer of data and type validation [[3]](https://www.speakeasy.com/blog/pydantic-vs-dataclasses), [[4]](https://codetain.com/blog/validators-approach-in-python-pydantic-vs-dataclasses/). If the LLM returns a string where an integer is expected, your application raises a clear validation error immediately, preventing bad data from propagating.

[![](https://substackcdn.com/image/fetch/$s_!04QT!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F2b5cc1ed-e1fc-4edb-9388-3740f827630a_1200x1200.png)](https://substackcdn.com/image/fetch/$s_!04QT!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F2b5cc1ed-e1fc-4edb-9388-3740f827630a_1200x1200.png)

Image 1: The benefits of structured outputs from LLMs, acting as a bridge between LLM (Software 3.0) and Python (Software 1.0) for downstream processing.

Furthermore, structured outputs are easier to orchestrate between steps in a workflow. When you know what information you have available, it is much simpler to pass it to the next LLM call or a downstream system like a database or API [[5]](https://www.prompts.ai/en/blog-details/automating-knowledge-graphs-with-llm-outputs), [[6]](https://humanloop.com/blog/structured-outputs). This control also reduces costs. By ensuring the LLM generates only the necessary data without useless artifacts (e.g., “Here is the output you requested...”), you reduce the number of output tokens.

> 💡 **Quick Tip:** You can easily compute the costs of running your workflows or agent by plugging in an LLMOps open-source tool such as [Opik](https://www.comet.com/site/?utm_source=newsletter&utm_medium=partner&utm_campaign=paul).

Ultimately, structured outputs create a formal contract between the LLM (Software 3.0) and your application code (Software 1.0). They are the standard method for modeling domain objects in AI engineering, connecting the probabilistic nature of LLMs with deterministic code.

## Implementing Structured Outputs From Scratch Using JSON

To understand how modern LLM APIs such as OpenAI and Gemini work under the hood, we will first implement structured outputs from scratch.

Our goal is to prompt a model to return a JSON object and then parse it into a Python dictionary. We will use an “LLM-as-judge” evaluation as our example, where we ask an LLM to compare a generated text against a ground-truth document and score it based on predefined criteria. This is a great use case, as it requires extracting specific, structured information from a large context.

1. First, we define our sample documents for the evaluation. These will serve as the input for our LLM judge:

```
GENERATED_DOCUMENT = “”“
# Q3 2023 Financial Performance Analysis

The Q3 earnings report shows a 20% increase in revenue and a 15% growth in user engagement, 
beating market expectations. These impressive results reflect our successful product strategy 
and strong market positioning.

Our core business segments demonstrated remarkable resilience, with digital services leading 
the growth at 25% year-over-year. The expansion into new markets has proven particularly 
successful, contributing to 30% of the total revenue increase.

Customer acquisition costs decreased by 10% while retention rates improved to 92%, 
marking our best performance to date. These metrics, combined with our healthy cash flow 
position, provide a strong foundation for continued growth into Q4 and beyond.
“”“

GROUND_TRUTH_DOCUMENT = “”“
# Q3 2023 Financial Performance Analysis

The Q3 earnings report shows a 18% increase in revenue and a 15% growth in user engagement, 
slightly below market expectations. These results reflect our product strategy adjustments 
and competitive market positioning challenges.

Our core business segments showed mixed performance, with digital services growing at 
22% year-over-year. The expansion into new markets has been challenging, contributing 
to only 15% of the total revenue increase.

Customer acquisition costs increased by 5% while retention rates remained at 88%, 
indicating areas for improvement. These metrics, combined with our cash flow position, 
suggest we need strategic adjustments for Q4 growth.
“”“
```

2. Next, we craft a prompt that instructs the LLM to evaluate the generated document against the ground truth and format the output as JSON. We provide a clear example of the desired structure and use XML tags like  to separate inputs from instructions. This is an effective prompt engineering technique for improving clarity and guiding the model’s output [[7]](https://aws.amazon.com/blogs/machine-learning/structured-data-response-with-amazon-bedrock-prompt-engineering-and-tool-use/), [[8]](https://help.openai.com/en/articles/6654000-best-practices-for-prompt-engineering-with-the-openai-api). The key is to be explicit about the format, keys, and value types you expect:

```
prompt = f”“”
You are an expert evaluator. Compare the generated document with the ground truth document and provide a score for each criterion.
The output must be a single, valid JSON object with the following structure:
{{
  “scores”: [
    {{
      “criterion”: “revenue_forecast”,
      “score”: 0 or 1,
      “reason”: “Your reasoning here.”
    }},
    {{
      “criterion”: “user_growth”,
      “score”: 0 or 1,
      “reason”: “Your reasoning here.”
    }},
    {{
      “criterion”: “facts”,
      “score”: 0 or 1,
      “reason”: “Your reasoning here.”
    }}
  ]
}}

Here are the documents:


{GENERATED_DOCUMENT}



{GROUND_TRUTH_DOCUMENT}

“”“
```

3. We send the prompt to the model and inspect the raw response. As expected, the model returns a JSON object, wrapped in Markdown *```json* code blocks:

```
from google import genai

client = genai.Client()

response = client.models.generate_content(model=”gemini-2.5-flash”, contents=prompt)
```

4. It outputs:

```
```json
{
  “scores”: [
    {
      “criterion”: “revenue_forecast”,
      “score”: 0,
      “reason”: “The generated document claims a 20% revenue increase, while the ground truth states an 18% increase, which is slightly below expectations. The forecast is factually incorrect.”
    },
    {
      “criterion”: “user_growth”,
      “score”: 1,
      “reason”: “Both documents report a 15% growth in user engagement, so this fact is correctly stated in the generated document.”
    },
    {
      “criterion”: “facts”,
      “score”: 0,
      “reason”: “The generated document contains several factual inaccuracies regarding revenue, market expansion contribution, customer acquisition costs, and retention rates when compared to the ground truth.”
    }
  ]
}
```

5. To handle this, we create a helper function to strip the Markdown tags, leaving a clean JSON string that can be safely parsed:

```
def extract_json_from_response(response: str) -> dict:
    “”“
    Extracts JSON from a response string that is wrapped in ```json tags.
    “”“
    response = response.replace(”```json”, “”).replace(”```”, “”)
    return json.loads(response)
```

6. Finally, we parse the string into a Python dictionary, which can now be used in our application:

```
parsed_response = extract_json_from_response(response.text)
```

7. It outputs:

```
{
  “scores”: [
    {
      “criterion”: “revenue_forecast”,
      “score”: 0,
      “reason”: “The generated document claims a 20% revenue increase, ...”
    },
    {
      “criterion”: “user_growth”,
      “score”: 1,
      “reason”: “Both documents report a 15% growth in user engagement, ...”
    },
    {
      “criterion”: “facts”,
      “score”: 0,
      “reason”: “The generated document contains several factual ...”
    }
  ]
}
```

This manual method works, but it relies on post-processing and lacks data validation. If the LLM makes a mistake like outputting a string instead of an integer or missing a dictionary key, our application will fail. Next, we will see how Pydantic provides a much more robust solution to this problem.

## Implementing Structured Outputs From Scratch Using Pydantic

Forcing JSON output is an improvement, but it still leaves you with a plain Python dictionary. You cannot be sure what is inside it, whether the keys are correct, or if the values have the right type. This uncertainty can lead to bugs and make your code difficult to maintain.

Pydantic solves this problem. It is a data validation library that enforces structure and type hints at runtime, ensuring data integrity from the moment it enters your application [[3]](https://www.speakeasy.com/blog/pydantic-vs-dataclasses). It provides a single, clear definition for your data structure and can automatically generate a JSON Schema from your Python class.

> **💡 Quick Tip**: I personally love Pydantic. I use it to model any data structure in my Python programs, completely dropping other options such as `@dataclass` or `TypedDict`.

When an LLM produces output that does not match your Pydantic model, the library raises a `ValidationError` that clearly explains what went wrong. This “fail-fast” behavior is essential for building reliable systems, preventing bad data from moving through your application and causing hard-to-debug errors later. This is a major improvement over simple JSON parsing, as it introduces a validation layer that catches errors early.

1. We define our desired data structure as a Pydantic class, using standard Python type hints to define the expected type for each field:

```
from typing import Literal
from typing_extensions import Annotated

import pydantic
from pydantic import Ge, Le

class CriterionScore(pydantic.BaseModel):
    “”“Model holding the score and reason for a specific criterion.”“”
    criterion: Literal[”revenue_forecast”, “user_growth”, “facts”]
    score: Annotated[int, Ge(0), Le(1)] = pydantic.Field(description=”Binary score of the section.”)
    reason: str = pydantic.Field(description=”The reason for the given score.”)

class Scores(pydantic.BaseModel):
    scores: list[CriterionScore]
```

*You can also nest Pydantic models to represent more complex, hierarchical data. This allows you to define intricate relationships between different pieces of information. However, it is good practice to keep schemas as simple as possible, as complex nested structures can confuse the LLM and lead to errors.*

2. With our Pydantic model defined, we can automatically generate a JSON Schema from it. A schema is the standard for defining the structure and constraints of your data, acting as a formal contract between your application and the LLM. This contract dictates the expected fields, their types, and any validation rules. Now, instead of providing a fuzzy JSON that explains how our output should look (as we did in the previous section), we provide an explicit schema to the LLM that is compatible with Pydantic. This is similar to the technique used internally by APIs like Gemini and OpenAI to enforce a specific output format [[9]](https://ai.google.dev/gemini-api/docs/structured-output):

```
schema = Scores.model_json_schema()
```

3. The generated schema is detailed and includes descriptions from the `Field` definitions to guide the generation process.

```
{
    “$defs”: {
        “CriterionScore”: {
            “properties”: {
                “criterion”: {
                    “enum”: [”revenue_forecast”, “user_growth”, “facts”],
                    “title”: “Criterion”,
                    “type”: “string”
                },
                “score”: {
                    “description”: “Binary score of the section.”,
                    “exclusiveMaximum”: 1,
                    “exclusiveMinimum”: 0,
                    “title”: “Score”,
                    “type”: “integer”
                },
                “reason”: {
                    “description”: “The reason for the given score.”,
                    “title”: “Reason”,
                    “type”: “string”
                }
            },
            “required”: [”criterion”, “score”, “reason”],
            “title”: “CriterionScore”,
            “type”: “object”
        }
    },
    “properties”: {
        “scores”: {
            “items”: {
                “$ref”: “#/$defs/CriterionScore”
            },
            “title”: “Scores”,
            “type”: “array”
        }
    },
    “required”: [”scores”],
    “title”: “Scores”,
    “type”: “object”
}
```

4. We update our prompt to include this JSON Schema:

```
prompt = f”“”
Please analyze the following documents and extract evaluation scores.
The output must be a single, valid JSON object that conforms to the following JSON Schema:
{json.dumps(schema, indent=2)}

Here are the documents:

{GENERATED_DOCUMENT}


{GROUND_TRUTH_DOCUMENT}

“”“
```

5. We call the model and extract the JSON string as before.

```
response = client.models.generate_content(model=MODEL_ID, contents=prompt)
parsed_response = extract_json_from_response(response.text)
```

6. It outputs:

```
{
  “scores”: [
    {
      “criterion”: “revenue_forecast”,
      “score”: 0,
      “reason”: “The generated document overstates revenue growth  ...”
    },
    {
      “criterion”: “user_growth”,
      “score”: 1,
      “reason”: “The 15% user engagement growth is correctly reported ....”
    },
    {
      “criterion”: “facts”,
      “score”: 0,
      “reason”: “The generated document contains multiple factual ....”
    }
  ]
}
```

7. But now, the biggest difference, is that we can load the output dictionary into our Pydantic model and validate it:

```
try:
    scores = Scores.model_validate(parsed_response)
    print(”Validation successful!”)
except Exception as e:
    print(f”Validation failed!”)
```

8. It outputs:

```
Validation successful!
```

The `scores` Pydantic object can now be safely used throughout your application. This is the main advantage: you move from unclear dictionaries to clean, predictable Python objects.

While Python’s built-in `dataclasses` or `TypedDict` can define structure, they only provide type hints for static analysis and do not perform runtime validation [[3]](https://www.speakeasy.com/blog/pydantic-vs-dataclasses), [[4]](https://codetain.com/blog/validators-approach-in-python-pydantic-vs-dataclasses/). If the LLM returns a string where an integer is expected, these tools will not catch the error.

To conclude, Pydantic’s runtime validation, type constraints, and clear schema definitions make it our favorite way for structuring and validating all our domain data structures from our AI apps.

## Implementing Structured Outputs Using Gemini and Pydantic

While Pydantic brings structure and validation, we still had to construct the prompts and handle responses manually. When working with modern APIs such as Gemini and OpenAI, the recommended way to generate structured outputs is by using their native features. This approach is simpler, more accurate, and often more cost-effective than manual prompt engineering, as the vendor will always handle the optimization on top of their models better than your manual prompting [[9]](https://ai.google.dev/gemini-api/docs/structured-output), [[10]](https://www.vellum.ai/blog/when-should-i-use-function-calling-structured-outputs-or-json-mode), [[11]](https://www.googlecloudcommunity.com/gc/AI-ML/Structured-Output-in-vertexAI-BatchPredictionJob/m-p/866640).

Let’s see how to achieve the same result for our LLM-as-judge example using the Gemini API’s native capabilities. The process becomes much simpler.

1. We define a `GenerateContentConfig` object, instructing the Gemini API to set the `response_mime_type` to `“application/json”` and the `response_schema` to our `Scores` Pydantic model. This configures the model to output JSON that is then automatically converted to the given Pydantic model. This single configuration step replaces the manual schema injection and parsing we did earlier:

```
from google.genai import types

config = types.GenerateContentConfig(
    response_mime_type=”application/json”,
    response_schema=Scores
)
```

2. This configuration makes our prompt significantly shorter and cleaner, eliminating the need to manually inject any type of schema. We simply ask the model to perform the task, as the output format is guided directly by the config:

```
prompt = f”“”
You are an expert evaluator. Compare the generated document with the ground truth document and provide a score for each criterion.

Here are the documents:

{GENERATED_DOCUMENT}


{GROUND_TRUTH_DOCUMENT}

“”“
```

3. Now, we call the model, passing our simplified prompt and the new configuration object. The API handles the rest, ensuring the output adheres to the schema.

```
response = client.models.generate_content(
    model=MODEL_ID,
    contents=prompt,
    config=config
)
```

4. The Gemini client automatically parses the output for us. By accessing the `response.parsed` attribute, we receive a ready-to-use instance of our `Scores` Pydantic model:

```
scores = response.parsed
print(f”Type of the response: `{type(scores)}`”)
```

5. It outputs:

```
Type of the response: ``
```

Similar patterns apply to all modern LLM APIs.

This native approach is robust, efficient, and requires less code. While it is the recommended way for closed-source APIs or AI frameworks, the “from scratch” method remains useful for open-source models that may not have this built-in functionality or when you do not have access to any AI framework.

## The Best Model for Structured Outputs

A final thought on what’s the best model for structured outputs: In general, all the latest LLMs support generating JSON, indirectly supporting Pydantic structures.

However, when building AI systems, there is never the problem of what’s the best model, but what’s the best model for your given use case. Almost always, you cannot tell which model is better until you actually test them. That’s why, when building AI systems, you should ALWAYS adopt a scientific method to find the optimal model (and its configuration):

1. Configure different parameters (e.g., different models).
2. Run experiments for each configuration.
3. Compute business metrics of interest (e.g., using an LLM-as-judge).
4. Use an LLMOps tool such as [Opik](https://www.comet.com/site/?utm_source=newsletter&utm_medium=partner&utm_campaign=paul) to analyze the results.
5. Pick the best configuration and iterate if needed.

[![](https://substackcdn.com/image/fetch/$s_!J6_X!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F15821967-c979-4a15-80b0-3329a835abd3_1200x1200.png)](https://substackcdn.com/image/fetch/$s_!J6_X!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F15821967-c979-4a15-80b0-3329a835abd3_1200x1200.png)

Image 2: The scientific method for evaluating and optimizing AI systems.

This high-level strategy works for tweaking any model, config or even feature of an AI system.

## Conclusion: Structured Outputs Are Everywhere

The thing is that structured outputs are everywhere! They are a fundamental pattern in AI engineering, connecting the probabilistic nature of LLMs with the deterministic world of software. Whether you are building a simple summarization workflow or a complex research agent, you will use structured outputs to ensure reliability and control.

Remember that this article is part of a longer series of 8 pieces on the AI Agents Foundations that will give you the tools to morph from a Python developer to an AI Engineer.

**Here’s our roadmap:**

1. [Workflows vs. Agents](https://decodingml.substack.com/p/ai-workflows-vs-agents-the-autonomy)
2. **Structured Outputs** *←* *You just finished this one.*
3. Workflow Patterns *← Move to this one (available next Tuesday, 9:00 am CET)*
4. Tools
5. Planning: ReAct & Plan-and-Execute
6. Writing ReAct From Scratch
7. Memory
8. Multimodal Data

See you next week.

[Paul Iusztin](https://www.linkedin.com/in/pauliusztin/)

---

*What’s your take on today’s topic? Do you agree, disagree, or is there something I missed?*

[Leave a comment](https://www.decodingai.com/p/llm-structured-outputs-the-only-way/comments)

---

*If you enjoyed this article, the ultimate compliment is to share our work.*

[Share](https://www.decodingai.com/p/llm-structured-outputs-the-only-way?utm_source=substack&utm_medium=email&utm_content=share&action=share)

---
