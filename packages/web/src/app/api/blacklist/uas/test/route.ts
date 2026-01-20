import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';

const testSchema = z.object({
  pattern: z.string().min(1, 'Pattern is required'),
  pattern_type: z.enum(['exact', 'contains', 'regex']).default('contains'),
  test_ua: z.string().min(1, 'Test UA is required'),
});

// POST /api/blacklist/uas/test - Test UA pattern matching
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const data = testSchema.parse(body);

    let matched = false;
    let matchPosition: number | undefined;
    let matchedText: string | undefined;

    switch (data.pattern_type) {
      case 'exact':
        matched = data.test_ua === data.pattern;
        if (matched) {
          matchPosition = 0;
          matchedText = data.pattern;
        }
        break;

      case 'contains':
        const index = data.test_ua.toLowerCase().indexOf(data.pattern.toLowerCase());
        matched = index !== -1;
        if (matched) {
          matchPosition = index;
          matchedText = data.test_ua.substring(index, index + data.pattern.length);
        }
        break;

      case 'regex':
        try {
          const regex = new RegExp(data.pattern, 'i');
          const match = data.test_ua.match(regex);
          matched = match !== null;
          if (match) {
            matchPosition = match.index;
            matchedText = match[0];
          }
        } catch (err) {
          return NextResponse.json(
            { error: { code: 'INVALID_REGEX', message: 'Invalid regex pattern', details: { error: String(err) } } },
            { status: 400 }
          );
        }
        break;
    }

    return NextResponse.json({
      data: {
        matched,
        match_position: matchPosition,
        matched_text: matchedText,
        pattern: data.pattern,
        pattern_type: data.pattern_type,
        test_ua: data.test_ua,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors } },
        { status: 400 }
      );
    }

    console.error('UA test error:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
