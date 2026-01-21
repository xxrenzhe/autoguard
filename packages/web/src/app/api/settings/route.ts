import { z } from 'zod';
import { getSettingsByCategory, setSetting, type SettingCategory } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';

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
    return errors.unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') as SettingCategory | null;

  if (category && !VALID_CATEGORIES.includes(category)) {
    return errors.validation('Invalid category', { category });
  }

  const settings: Record<string, Record<string, unknown>> = {};

  if (category) {
    settings[category] = getSettingsByCategory(category, user.userId);
  } else {
    for (const cat of VALID_CATEGORIES) {
      settings[cat] = getSettingsByCategory(cat, user.userId);
    }
  }

  return success(settings);
}

// POST /api/settings - 更新设置
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
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

    return success({ ok: true }, 'Setting updated');
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errors.validation('Invalid input', { errors: error.errors });
    }

    console.error('Update setting error:', error);
    return errors.internal();
  }
}

// PUT /api/settings - 批量更新设置
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
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

    return success({ updated: settings.length }, `Updated ${settings.length} settings`);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errors.validation('Invalid input', { errors: error.errors });
    }

    console.error('Bulk update settings error:', error);
    return errors.internal();
  }
}
