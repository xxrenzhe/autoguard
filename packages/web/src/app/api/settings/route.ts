import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSettingsByCategory, setSetting, type SettingCategory } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';

const VALID_CATEGORIES: SettingCategory[] = ['ai', 'proxy', 'system', 'cloak'];

const updateSettingSchema = z.object({
  category: z.enum(['ai', 'proxy', 'system', 'cloak']),
  key: z.string().min(1).max(100),
  value: z.unknown(),
  options: z.object({
    isSensitive: z.boolean().optional(),
    dataType: z.enum(['string', 'number', 'boolean', 'json']).optional(),
  }).optional(),
});

// GET /api/settings - 获取设置
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') as SettingCategory | null;

  if (category && !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json(
      { error: { code: 'INVALID_CATEGORY', message: 'Invalid category' } },
      { status: 400 }
    );
  }

  const settings: Record<string, Record<string, unknown>> = {};

  if (category) {
    settings[category] = getSettingsByCategory(category, user.userId);
  } else {
    for (const cat of VALID_CATEGORIES) {
      settings[cat] = getSettingsByCategory(cat, user.userId);
    }
  }

  return NextResponse.json({
    success: true,
    data: settings,
  });
}

// POST /api/settings - 更新设置
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
    const data = updateSettingSchema.parse(body);

    setSetting(
      data.category,
      data.key,
      data.value,
      user.userId,
      data.options
    );

    return NextResponse.json({
      success: true,
      message: 'Setting updated',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors } },
        { status: 400 }
      );
    }

    console.error('Update setting error:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}

// PUT /api/settings - 批量更新设置
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const settings = z.array(updateSettingSchema).parse(body.settings);

    for (const setting of settings) {
      setSetting(
        setting.category,
        setting.key,
        setting.value,
        user.userId,
        setting.options
      );
    }

    return NextResponse.json({
      success: true,
      message: `Updated ${settings.length} settings`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors } },
        { status: 400 }
      );
    }

    console.error('Bulk update settings error:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
