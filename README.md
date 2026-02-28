# axme-sdk-typescript

Official TypeScript SDK for Axme APIs and workflows.

## Status

Initial v1 skeleton in progress.

## Quickstart

```ts
import { AxmeClient } from "@axme/sdk";

const client = new AxmeClient({
  baseUrl: "https://gateway.example.com",
  apiKey: "YOUR_API_KEY",
});

console.log(await client.health());
```

## Development

```bash
npm install
npm test
```
