import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { BedrockRuntimeClient, InvokeModelCommandInput } from '@aws-sdk/client-bedrock-runtime';
import type { S3VectorsClient, PutVectorsCommandInput, DeleteVectorsCommandInput } from '@aws-sdk/client-s3vectors';
import { extractText, generateEmbedding, indexPost, clearVectors } from './index-content';

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
};

// --- FIXTURE ---

const FIXTURE_MDX = `---
title: "Test Cookbook Review Title"
cookbook: "Test Cookbook"
cookbookAuthor: ["Author One"]
date: "2026-06-03"
rating: 4
slug: "test-cookbook"
description: "A test review."
tags: ["test"]
coverImage: "./images/cover.jpg"
isbn: "9780000000000"
---

## A Heading 

Some **bold** text and a [link](https://example.com).   
`;

let fixturePath: string;

beforeAll(async () => {
    fixturePath = join(tmpdir(), 'test-cookbook.mdx');
    await writeFile(fixturePath, FIXTURE_MDX, 'utf-8');
});

afterAll(async () => {
    await unlink(fixturePath);
});

// --- TESTS ---

describe('extractText', () => {
    // TEST 1
    it('strips frontmatter and returns plain text body', async() => {
        const result = await extractText(FIXTURE_MDX);
        
        expect(result).not.toContain('Test Cookbook Review Title');
        expect(result).toContain('A Heading');
        expect(result).toContain('Some bold text and a link')
    });

    // TEST 2
    it('strips markdown syntax from headings and inline formatting', async() => {
        const result = await extractText(FIXTURE_MDX);

        expect(result).not.toContain('## A Heading');
        expect(result).not.toContain('**bold**');
        expect(result).not.toContain('[link]');
    });

    // TEST 3
    it('trims surrounding whitespace', async() => {
        const result = await extractText(FIXTURE_MDX);

        expect(result).not.toMatch(/^\s/);
        expect(result).not.toMatch(/\s$/);
    });
});

describe('generateEmbedding', () => {
    // TEST 4
    it('calls Bedrock with the correct model id', async () => {
        const bedrock = makeFakeBedrock([0.1, 0.2, 0.3]);
        await generateEmbedding('some text', bedrock);

        const sentCommand = vi.mocked(bedrock.send).mock.calls[0][0];
        const input = sentCommand.input as InvokeModelCommandInput;
        expect(input.modelId).toBe('amazon.titan-embed-text-v2:0');
    });
 
    // TEST 5
    it('passes the input text in the request body', async () => {
        const bedrock = makeFakeBedrock([0.1, 0.2, 0.3]);
        await generateEmbedding('some text', bedrock);

        const sentCommand = vi.mocked(bedrock.send).mock.calls[0][0];
        const input = sentCommand.input as InvokeModelCommandInput;
        const body = JSON.parse(input.body as string);
        expect(body.inputText).toBe('some text');
    });

    // TEST 6
    it('returns the embedding array from the response', async () => {
        const bedrock = makeFakeBedrock([0.1, 0.2, 0.3]);
        const response = await generateEmbedding('some text', bedrock);

        expect(response).toEqual([0.1, 0.2, 0.3]);
    });
});

describe('indexPost', () => {
    // TEST 7
    it('uses the slug as the vector key', async () => {
        const bedrock = makeFakeBedrock([0.1, 0.2, 0.3]);
        const s3vectors = makeFakeS3Vectors({});
        await indexPost(fixturePath, bedrock, s3vectors);

        const sentCommand = vi.mocked(s3vectors.send).mock.calls[0][0];
        const input = sentCommand.input as PutVectorsCommandInput;
        expect(input.vectors![0].key).toBe('test-cookbook');
    });

    // TEST 8
    it('writes all frontmatter fields to metadata', async () => {
        const bedrock = makeFakeBedrock([0.1, 0.2, 0.3]);
        const s3vectors = makeFakeS3Vectors({});
        await indexPost(fixturePath, bedrock, s3vectors);

        const sentCommand = vi.mocked(s3vectors.send).mock.calls[0][0];
        const input = sentCommand.input as PutVectorsCommandInput;
        expect(input.vectors![0].metadata).toEqual({
            title: "Test Cookbook Review Title",
            cookbook: "Test Cookbook",
            cookbookAuthor: ["Author One"],
            date: "2026-06-03",
            rating: 4,
            slug: "test-cookbook",
            description: "A test review.",
            tags: ["test"],
            coverImage: "./images/cover.jpg",
            isbn: "9780000000000",
        });
    });

    // TEST 9
    it('includes frontmatter fields in the embedded text', async () => {
        const bedrock = makeFakeBedrock([0.1, 0.2, 0.3]);
        const s3vectors = makeFakeS3Vectors({});
        await indexPost(fixturePath, bedrock, s3vectors);

        const sentCommand = vi.mocked(bedrock.send).mock.calls[0][0];
        const input = sentCommand.input as InvokeModelCommandInput;
        const body = JSON.parse(input.body as string);
        expect(body.inputText).toContain('Test Cookbook Review Title');
        expect(body.inputText).toContain('Test Cookbook');
        expect(body.inputText).toContain('Author One');
        expect(body.inputText).toContain('A test review.');
    });
});

describe('clearVectors', () => {
    // TEST 10
    it('does not call DeleteVectors when the index is empty', async () => {
        const s3vectors = makeFakeS3Vectors({ vectors: [] });
        await clearVectors(s3vectors);

        expect(vi.mocked(s3vectors.send).mock.calls.length).toBe(1);    // only ListVectors, no DeleteVectors
    });

    // TEST 11
    it('deletes all keys returned by ListVectors', async () => {
        const s3vectors = makeFakeS3Vectors( 
            { vectors: [{ key: 'post-one' }, { key: 'post-two' }] },
            {}
        );
        await clearVectors(s3vectors);

        const sentCommand = vi.mocked(s3vectors.send).mock.calls[1][0];
        const input = sentCommand.input as DeleteVectorsCommandInput;
        expect(input.keys).toEqual(['post-one', 'post-two']);        
    });

    // TEST 12
    it('collects keys across multiple pages before deleting', async () => {
        const s3vectors = makeFakeS3Vectors(
            { vectors: [{ key: 'post-one'}], nextToken: 'page2'},
            { vectors: [{ key: 'post-two'}] },
            {}
        );
        await clearVectors(s3vectors);

        const sentCommand = vi.mocked(s3vectors.send).mock.calls[2][0];
        const input = sentCommand.input as DeleteVectorsCommandInput;
        expect(input.keys).toEqual(['post-one', 'post-two']);
    });
});