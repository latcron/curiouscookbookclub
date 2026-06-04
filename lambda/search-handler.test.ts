import { vi, describe, it, expect } from 'vitest';
import type { BedrockRuntimeClient, InvokeModelCommandInput } from '@aws-sdk/client-bedrock-runtime';
import type { S3VectorsClient, QueryVectorsCommandInput } from '@aws-sdk/client-s3vectors';
import { embedQuery, searchVectors, formatResponse, SearchResult } from './search-handler';

// --- FAKES ---
const makeEmbeddingResponse = (embedding: number[]) => ({
    body: Buffer.from(JSON.stringify({ embedding })),
});

const makeFakeBedrock = (embedding: number[]) => ({
    send: vi.fn().mockResolvedValue(makeEmbeddingResponse(embedding)),
}) as unknown as BedrockRuntimeClient;

const makeFakeS3Vectors = (...responses: unknown[]) => {
    const send = vi.fn();
    responses.forEach(r => send.mockResolvedValueOnce(r));
    return { send } as unknown as S3VectorsClient;
}

const fakeResult: SearchResult = {
    slug: 'salt-fat-acid-heat-review',
    title: 'A Love Letter to Salt Fat Acid Heat',
    cookbook: 'Salt, Fat, Acid, Heat',
    cookbookAuthor: ['Samin Nosrat'],
    date: '2024-03-15',
    rating: 5,
    description: 'The book that changed how I think about cooking.',
    tags: ['technique', 'fundamentals'],
    coverImage: '/images/salt-fat-acid-heat.jpg',
    isbn: '9781476753836',
};


// --- TESTS ---
describe('embedQuery', () => {
    // TEST 1
    it('returns the embedding from the Bedrock response', async() => {
        const bedrock = makeFakeBedrock([0.1, 0.2, 0.3]);
        const response = await embedQuery('french cooking', bedrock);
        
        expect(response).toEqual([0.1, 0.2, 0.3]);
    });

    // TEST 2
    it('call Bedrock with the right modelId and input text', async() => {
        const bedrock = makeFakeBedrock([0.1, 0.2, 0.3]);
        await embedQuery('some text', bedrock);

        const sentCommand = vi.mocked(bedrock.send).mock.calls[0][0];
        const input = sentCommand.input as InvokeModelCommandInput;
        expect(input.modelId).toBe('amazon.titan-embed-text-v2:0');
        const body = JSON.parse(input.body as string);
        expect(body.inputText).toBe('some text');

    });
});

describe('searchVectors', () => {
    // TEST 3
    it('returns results mapped from vector metadata', async() => {
        const s3vectors = makeFakeS3Vectors({ vectors: [{ metadata: fakeResult }] });
        const response = await searchVectors([0.1, 0.2, 0.3], s3vectors);

        expect(response).toEqual([fakeResult])
    });

    // TEST 4
    it('returns an empty array when vectors is undefined', async() => {
        const s3vectors = makeFakeS3Vectors({ vectors: undefined });
        const response = await searchVectors([0.1, 0.2, 0.3], s3vectors);

        expect(response).toEqual([]);
    });

    // TEST 5
    it('passes topK:5 and returnMetaData: true to vector store', async() => {
        const s3vectors = makeFakeS3Vectors({ vectors: [{ metadata: fakeResult }] });
        await searchVectors([0.1, 0.2, 0.3], s3vectors);

        const sentCommand = vi.mocked(s3vectors.send).mock.calls[0][0];
        const input = sentCommand.input as QueryVectorsCommandInput;
        expect(input.topK).toBe(5);
        expect(input.returnMetadata).toBe(true);
    });
});

describe('formatResponse', () => {
    // TEST n
    it('formats the SearchResult and returns the search results with statusCode 200', async() => {
        const response = formatResponse([fakeResult]);

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body as string);
        expect(body).toEqual([fakeResult]);
    });
})