# @zeeman-effect/plugin-pdf

This package is a plugin for the (Maiar)[https://maiar.dev] AI ecosystem, designed to work with the `@maiar-ai/core` package.

## Documentation

For detailed documentation on how to use plugins, please refer to the [Maiar documentation](https://maiar.dev/docs).

## Plugin Information

### Actions

- `handlePDF`: Handle a PDF file from a buffer or URL and add the text to the conversation context for further analysis
- `analyzePDFFromPrompt`: Analyze the text and image in the PDF file and add it to the conversation context for further analysis
- `analyzePDFFromSegment`: Analyze a segment of the PDF with a prompt using the full text from the conversation context to provide additional information

### Setup

```ts
import { PluginPDF } from "@zeeman-effect/plugin-pdf";
import { createRuntime } from "@maiar-ai/core";

const runtime = createRuntime({
    plugins: [new PluginPDF()],
});
```

### Example

See the [example](./example) directory for a complete example of how to use the plugin.
