import 'dotenv/config';
import matter from 'gray-matter';
import { remark } from 'remark';
import stripMarkDown from 'strip-markdown';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { S3VectorsClient, PutVectorsCommand, ListVectorsCommand, DeleteVectorsCommand } from '@aws-sdk/client-s3vectors';
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const { VECTOR_BUCKET_NAME, VECTOR_INDEX_NAME, AWS_REGION } = process.env;
if (!VECTOR_BUCKET_NAME) throw new Error('Missing required env var: VECTOR_BUCKET_NAME');
if (!VECTOR_INDEX_NAME) throw new Error('Missing required env var: VECTOR_INDEX_NAME');
if (!AWS_REGION) throw new Error('Missing required env var: AWS_REGION');

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = join(__dirname, '../frontend/content');


export async function extractText(mdxContent: string): Promise<string> {
    const { content } = matter(mdxContent);
    const result = await remark().use(stripMarkDown).process(content);
    return result.toString().trim();
}

export async function generateEmbedding(text: string, client: BedrockRuntimeClient): Promise<number[]> {
    const response = await client.send(new InvokeModelCommand({
        modelId: 'amazon.titan-embed-text-v2:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ inputText: text }),
    }));
    const parsed = JSON.parse(Buffer.from(response.body).toString());
    return parsed.embedding;
}

export async function indexPost(filePath: string, bedrock: BedrockRuntimeClient, s3vectors: S3VectorsClient): Promise<void> {
    const raw = await readFile(filePath, 'utf-8');
    const { data: frontmatter } = matter(raw);
    const bodyText = await extractText(raw);
    const textToEmbed = [
        frontmatter.title,
        frontmatter.cookbook,
        (frontmatter.cookbookAuthor as string[]).join(', '),
        frontmatter.description,
        bodyText,
    ].join('\n\n');
    const embedding = await generateEmbedding(textToEmbed, bedrock);

    await s3vectors.send(new PutVectorsCommand({
        vectorBucketName: VECTOR_BUCKET_NAME,
        indexName: VECTOR_INDEX_NAME,
        vectors: [{
            key: frontmatter.slug,
            data: { float32: embedding },
            metadata: { 
                title: frontmatter.title,
                slug: frontmatter.slug,
                description: frontmatter.description,
                date: frontmatter.date,
                cookbook: frontmatter.cookbook,
                cookbookAuthor: frontmatter.cookbookAuthor,
                rating: frontmatter.rating,
                tags: frontmatter.tags,
                coverImage: frontmatter.coverImage,
                isbn: frontmatter.isbn,
            },
        }],
    }));
}

export async function clearVectors(s3vectors: S3VectorsClient): Promise<void> {
    const vectorBucketName = VECTOR_BUCKET_NAME;
    const indexName = VECTOR_INDEX_NAME;
    const keys: string[] = [];
    let nextToken: string | undefined;

    do {
        const response = await s3vectors.send(new ListVectorsCommand({
            vectorBucketName,
            indexName,
            nextToken,
        }));
        for (const v of response.vectors ?? []) {
            if (v.key !== undefined) keys.push(v.key);
        }
        nextToken = response.nextToken;
    } while (nextToken);

    if (keys.length === 0) return;

    await s3vectors.send(new DeleteVectorsCommand({
        vectorBucketName,
        indexName,
        keys,
    }));
}

async function main() {
    const bedrock = new BedrockRuntimeClient({ region: AWS_REGION });
    const s3vectors = new S3VectorsClient({ region: AWS_REGION });

    console.log('Clearing existing vectors...');
    await clearVectors(s3vectors);

    const files = (await readdir(CONTENT_DIR))
        .filter(f => f.endsWith('.mdx'));

    for (const file of files) {
        console.log(`Indexing ${file}...`);
        await indexPost(join(CONTENT_DIR, file), bedrock, s3vectors);
    }
    console.log(`Indexed ${files.length} posts.`);
}

main();