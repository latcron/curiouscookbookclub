import 'dotenv/config';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { S3VectorsClient, QueryVectorsCommand } from '@aws-sdk/client-s3vectors';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const { VECTOR_BUCKET_NAME, VECTOR_INDEX_NAME, AWS_REGION } = process.env;
if (!VECTOR_BUCKET_NAME) throw new Error('Missing required env var: VECTOR_BUCKET_NAME');
if (!VECTOR_INDEX_NAME) throw new Error('Missing required env var: VECTOR_INDEX_NAME');
if (!AWS_REGION) throw new Error('Missing required env var: AWS_REGION');

export interface SearchResult {
    slug: string;
    title: string;
    cookbook: string;
    cookbookAuthor: string[];
    date: string;
    rating: number;
    description: string;
    tags: string[];
    coverImage: string;
    isbn: string;
}


export async function embedQuery(query: string, bedrock: BedrockRuntimeClient): Promise<number[]> {
    const response = await bedrock.send(new InvokeModelCommand({
        modelId: 'amazon.titan-embed-text-v2:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ inputText: query }),
    }));
    const parsed = JSON.parse(Buffer.from(response.body).toString());
    return parsed.embedding;
}


export async function searchVectors(embedding: number[], s3vectors: S3VectorsClient): Promise<SearchResult[]> {
    const response = await s3vectors.send(new QueryVectorsCommand({
        vectorBucketName: VECTOR_BUCKET_NAME!,
        indexName: VECTOR_INDEX_NAME!,
        queryVector: { float32: embedding },
        topK: 5,
        returnMetadata: true,
    }));

    return (response.vectors ?? []).map(v => v.metadata as unknown as SearchResult);
}

export function formatResponse(results: SearchResult[]): APIGatewayProxyResult {
    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(results),
    };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const q = event.queryStringParameters?.q;
    if (!q) {
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: 'Missing query parameter: q',
        }
    }

    const bedrock = new BedrockRuntimeClient({ region: AWS_REGION });
    const s3vectors = new S3VectorsClient({ region: AWS_REGION });

    const queryEmbedding = await embedQuery(q, bedrock);
    const searchResults = await searchVectors(queryEmbedding, s3vectors);
    return formatResponse(searchResults);
}