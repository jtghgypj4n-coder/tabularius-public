# Semantic search and RAG on your own computer

Insert Embedding, Perform Semantic Find, GetEmbedding and Perform RAG Action need an embedding model. Anthropic has no
embeddings API, so Tabularius asks a separate one. The simplest is a model running on the same computer, with nothing
sent over the internet and no key.

## With Ollama

1. Install [Ollama](https://ollama.com) and fetch an embedding model: `ollama pull nomic-embed-text`
2. Start the server with the model named:

   ```
   tabularius serve ./files --ai-embed-url ollama
   ```

`ollama` stands for `http://localhost:11434/v1`, and the model defaults to `nomic-embed-text`. Name another with
`--ai-embed-model`.

## With LM Studio

1. In LM Studio, download an embedding model (for example `nomic-embed-text-v1.5`) and start the local server (Developer tab).
2. Start tabularius:

   ```
   tabularius serve ./files --ai-embed-url lmstudio --ai-embed-model text-embedding-nomic-embed-text-v1.5
   ```

`lmstudio` stands for `http://localhost:1234/v1`. Use the model name LM Studio shows for the model you loaded.

## Any other OpenAI-compatible endpoint

`--ai-embed-url https://host/v1 --ai-embed-model NAME` works with OpenAI, vLLM, Voyage and anything else that answers
`POST /embeddings` the OpenAI way. If it needs a key, put it in `TABULARIUS_AI_EMBED_KEY`. The same settings can be given as
`TABULARIUS_AI_EMBED_URL` and `TABULARIUS_AI_EMBED_MODEL`.

## No Anthropic key needed

Without `--ai`, a server with an embedding model runs the embedding and RAG steps and nothing else. Steps that ask a model
(Generate Response from Model, Perform RAG Action's Send Prompt, Perform Find by Natural Language) stop saying the model is off. Add
`--ai` and an Anthropic key (see the README) to turn them on as well.

## Finding records by meaning from an AI app

With an embedding model the MCP server offers `semantic_find`: an AI app asks for "customers unhappy about late delivery" and gets
the record ids whose stored embedding is closest, best first, with a similarity from -1 to 1. It reads the vectors in a field of a
layout (a container field that Insert Embedding filled, or a text field holding a vector as a JSON array), made with the same model
the server uses. It follows the same rules as the other tools: the file's AI switch, the account's privileges (only records it can view
are compared, and the vector field must be readable), and the read log. It is refused while personal data isolation is on. The
question text goes to the embedding model, so with a hosted endpoint it leaves the server. At most 50,000 records are compared, and a
scan that takes more than 10 seconds answers with what it has and says so. The question counts against the same daily and monthly AI limits as a script's embeddings, and is at most 8,000 characters.

A vector carries some of its source text's meaning, and `semantic_find` lets an account query it by meaning with the server's own model. So give an embedding field the same access as the field it was made from: if `Diagnosis` is hidden from an account, so should the field holding its embedding be. Files in the vector field that are not the size of a vector (8 bytes and 8 per number, up to 8,192 numbers) are skipped without being read.

## Check it

```
tabularius doctor ./files --ai-embed-url ollama
```

asks the model for the vector of one word and tells you how many numbers it has, or what is wrong: the server isn't running,
the model isn't pulled, or the name is one that isn't an embedding model. With `TABULARIUS_AI_EMBED_URL` set, a plain
`tabularius doctor` checks it too.

## Things to know

- Pick the model once. Vectors from different models can't be compared, so changing the model means adding a RAG space's data again
  and running Insert Embedding in Found Set again. A RAG space made with another model says so (and refuses new data) until you remove its data.
- A RAG space holds at most 50,000 chunks (about 200 tokens each, so roughly 10 million tokens of text). A document that would pass the
  cap is refused whole, with "remove documents first"; adding a document of the same name replaces the old one and counts only the new
  chunks. A search compares every chunk (there is no approximate index): the vectors of a searched space are kept in memory, up to 256 MB per
  server process, and a space too big for that is read from disk on each search. A test fills a space to the cap and checks all of this.
- These limits were checked against stand-in embedding services and a model served locally, not against a Claris-hosted RAG account. Send
  Prompt's defaults (5 results, threshold 0) come from Claris help and were not checked against a real FileMaker Server. See
  [Script steps support](script-steps-support.md) for the rest.
- A file's AI switch and personal data isolation apply to the embedding steps as they do to the assistant.

## Searching by image

Perform Semantic Find with Query by: Image sends the picture in its Text box (a container field or a function like
Base64Decode) to an image embedding model and finds the records whose vectors are closest.

    TABULARIUS_AI_IMAGE_EMBED_KEY=... tabularius serve ./data --ai-image-embed voyage

`voyage` is Voyage multimodal (`voyage-multimodal-3` unless `--ai-image-embed-model` names another); `jina` is Jina CLIP
(`jina-clip-v2`). Another provider is one more entry in `packages/server/src/image-embed.ts`. The picture goes to the
provider, so the file's AI switch and personal data isolation apply. The vectors stored in the field must come from the same
model, or the comparison means nothing.

Search is exact: every vector is compared. There is no approximate-search (ANN) index, and none is planned until spaces near
the 50,000-chunk limit.
