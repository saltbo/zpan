export const ARAZZO_DOCUMENT_PATH = '/api/workflows.arazzo.json'
export const ARAZZO_MEDIA_TYPE = 'application/vnd.oai.workflows+json; version=1.1.0'

export function createArazzoDocument(origin: string) {
  return {
    arazzo: '1.1.0',
    $self: `${origin}${ARAZZO_DOCUMENT_PATH}`,
    info: {
      title: 'ZPan API workflows',
      summary: 'Machine-readable file workflows for the ZPan API',
      description:
        'These workflows compose the OpenAPI operations around direct-to-storage uploads. Presigned storage requests are executed from the runtime upload descriptor returned by prepareDirectFileUpload.',
      version: '1.0.0',
    },
    sourceDescriptions: [
      {
        name: 'zpan',
        url: './openapi.json',
        type: 'openapi',
      },
    ],
    workflows: [
      {
        workflowId: 'prepareDirectFileUpload',
        summary: 'Prepare a direct file upload',
        description:
          'Creates a file draft and returns the runtime upload descriptor. PUT every local file slice identified by upload.parts[].offset and upload.parts[].length to upload.parts[].url with upload.parts[].headers. Capture each response ETag, then invoke completeDirectFileUpload. If a presigned URL expires, invoke refreshDirectFileUploadParts. File bytes are sent directly to storage, not to ZPan.',
        inputs: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1 },
            contentType: { type: 'string', minLength: 1 },
            size: { type: 'integer', minimum: 0 },
            parent: { type: 'string', default: '' },
            onConflict: {
              type: 'string',
              enum: ['fail', 'rename', 'replace'],
              default: 'fail',
            },
          },
          required: ['name', 'contentType', 'size', 'parent', 'onConflict'],
        },
        steps: [
          {
            stepId: 'createUploadDraft',
            operationId: 'createObject',
            requestBody: {
              contentType: 'application/json',
              payload: {
                name: '$inputs.name',
                type: '$inputs.contentType',
                size: '$inputs.size',
                parent: '$inputs.parent',
                onConflict: '$inputs.onConflict',
              },
            },
            successCriteria: [{ condition: '$statusCode == 201' }],
            outputs: {
              objectId: '$response.body#/id',
              sessionId: '$response.body#/upload/sessionId',
              upload: '$response.body#/upload',
            },
          },
        ],
        outputs: {
          objectId: '$steps.createUploadDraft.outputs.objectId',
          sessionId: '$steps.createUploadDraft.outputs.sessionId',
          upload: '$steps.createUploadDraft.outputs.upload',
        },
      },
      {
        workflowId: 'refreshDirectFileUploadParts',
        summary: 'Refresh expired direct-upload URLs',
        description:
          'Requests replacement presigned URLs for selected multipart upload parts. Continue using the returned offset, length, headers, and URL for each part.',
        inputs: {
          type: 'object',
          properties: {
            objectId: { type: 'string', minLength: 1 },
            sessionId: { type: 'string', minLength: 1 },
            partNumbers: {
              type: 'array',
              minItems: 1,
              items: { type: 'integer', minimum: 1 },
            },
          },
          required: ['objectId', 'sessionId', 'partNumbers'],
        },
        steps: [
          {
            stepId: 'refreshUploadParts',
            operationId: 'presignObjectUploadParts',
            parameters: [
              { name: 'id', in: 'path', value: '$inputs.objectId' },
              { name: 'uploadSessionId', in: 'path', value: '$inputs.sessionId' },
            ],
            requestBody: {
              contentType: 'application/json',
              payload: { partNumbers: '$inputs.partNumbers' },
            },
            successCriteria: [{ condition: '$statusCode == 200' }],
            outputs: {
              uploadParts: '$response.body',
            },
          },
        ],
        outputs: {
          uploadParts: '$steps.refreshUploadParts.outputs.uploadParts',
        },
      },
      {
        workflowId: 'completeDirectFileUpload',
        summary: 'Complete a direct file upload',
        description:
          'Finalizes a prepared upload after every part has been PUT to storage. Supply one partNumber and captured ETag for every advertised part.',
        inputs: {
          type: 'object',
          properties: {
            objectId: { type: 'string', minLength: 1 },
            sessionId: { type: 'string', minLength: 1 },
            parts: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  partNumber: { type: 'integer', minimum: 1 },
                  etag: { type: 'string', minLength: 1 },
                },
                required: ['partNumber', 'etag'],
              },
            },
          },
          required: ['objectId', 'sessionId', 'parts'],
        },
        steps: [
          {
            stepId: 'completeUpload',
            operationId: 'completeObjectUpload',
            parameters: [
              { name: 'id', in: 'path', value: '$inputs.objectId' },
              { name: 'uploadSessionId', in: 'path', value: '$inputs.sessionId' },
            ],
            requestBody: {
              contentType: 'application/json',
              payload: { parts: '$inputs.parts' },
            },
            successCriteria: [{ condition: '$statusCode == 200' }],
            outputs: {
              object: '$response.body',
            },
          },
        ],
        outputs: {
          object: '$steps.completeUpload.outputs.object',
        },
      },
      {
        workflowId: 'abortDirectFileUpload',
        summary: 'Abort an unfinished direct file upload',
        description: 'Discards an unfinished upload session and its draft object.',
        inputs: {
          type: 'object',
          properties: {
            objectId: { type: 'string', minLength: 1 },
            sessionId: { type: 'string', minLength: 1 },
          },
          required: ['objectId', 'sessionId'],
        },
        steps: [
          {
            stepId: 'abortUpload',
            operationId: 'abortObjectUpload',
            parameters: [
              { name: 'id', in: 'path', value: '$inputs.objectId' },
              { name: 'uploadSessionId', in: 'path', value: '$inputs.sessionId' },
            ],
            successCriteria: [{ condition: '$statusCode == 204' }],
          },
        ],
      },
    ],
  } as const
}
