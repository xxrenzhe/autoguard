import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';

const testSchema = z.object({
  pattern: z.string().min(1, 'Pattern is required'),
  pattern_type: z.enum(['exact', 'contains', 'regex']).default('contains'),
  test_ua: z.string().min(1, 'Test UA is required'),
});

// POST /api/blacklist/uas/test - Test UA pattern matching
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  try {
    const body = await request.json();
    const data = testSchema.parse(body);

    let matched = false;
    let matchPosition: number | undefined;
    let matchedText: string | undefined;

    switch (data.pattern_type) {
      case 'exact': {
        matched = data.test_ua === data.pattern;
        if (matched) {
          matchPosition = 0;
          matchedText = data.pattern;
        }
        break;
      }

      case 'contains': {
        const index = data.test_ua.toLowerCase().indexOf(data.pattern.toLowerCase());
        matched = index !== -1;
        if (matched) {
          matchPosition = index;
          matchedText = data.test_ua.substring(index, index + data.pattern.length);
        }
        break;
      }

      case 'regex': {
        try {
          const regex = new RegExp(data.pattern, 'i');
          const match = data.test_ua.match(regex);
          matched = match !== null;
          if (match) {
            matchPosition = match.index;
            matchedText = match[0];
          }
        } catch (err) {
          return errors.validation('Invalid regex pattern', { error: String(err) });
        }
        break;
      }
    }

    return success({
      matched,
      match_position: matchPosition,
      matched_text: matchedText,
      pattern: data.pattern,
      pattern_type: data.pattern_type,
      test_ua: data.test_ua,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errors.validation('Invalid input', { errors: error.errors });
    }

    console.error('UA test error:', error);
    return errors.internal();
  }
}
