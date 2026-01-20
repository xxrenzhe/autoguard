'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface User {
  id: number;
  email: string;
  display_name: string | null;
  role: 'admin' | 'user';
  status: 'active' | 'suspended';
  last_login_at: string | null;
  created_at: string;
}

interface UsersResponse {
  success: boolean;
  data: User[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    display_name: '',
    role: 'user' as 'admin' | 'user',
  });

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', meta.page.toString());
      params.set('limit', meta.limit.toString());
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);

      const res = await fetch(`/api/admin/users?${params.toString()}`);
      const data: UsersResponse = await res.json();

      if (data.success) {
        setUsers(data.data);
        setMeta(data.meta);
      } else {
        toast.error('获取用户列表失败');
      }
    } catch {
      toast.error('网络错误');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [meta.page, statusFilter]);

  const handleSearch = () => {
    setMeta((prev) => ({ ...prev, page: 1 }));
    fetchUsers();
  };

  const handleCreate = async () => {
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();

      if (data.success) {
        toast.success('用户创建成功');
        setCreateDialogOpen(false);
        setFormData({ email: '', password: '', display_name: '', role: 'user' });
        fetchUsers();
      } else {
        toast.error(data.error?.message || '创建失败');
      }
    } catch {
      toast.error('网络错误');
    }
  };

  const handleUpdate = async () => {
    if (!selectedUser) return;

    try {
      const res = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: formData.display_name,
          role: formData.role,
        }),
      });
      const data = await res.json();

      if (data.success) {
        toast.success('用户更新成功');
        setEditDialogOpen(false);
        setSelectedUser(null);
        fetchUsers();
      } else {
        toast.error(data.error?.message || '更新失败');
      }
    } catch {
      toast.error('网络错误');
    }
  };

  const handleToggleStatus = async (user: User) => {
    const newStatus = user.status === 'active' ? 'suspended' : 'active';

    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();

      if (data.success) {
        toast.success(`用户已${newStatus === 'active' ? '启用' : '停用'}`);
        fetchUsers();
      } else {
        toast.error(data.error?.message || '操作失败');
      }
    } catch {
      toast.error('网络错误');
    }
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`确定要删除用户 ${user.email} 吗？此操作不可恢复。`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();

      if (data.success) {
        toast.success('用户已删除');
        fetchUsers();
      } else {
        toast.error(data.error?.message || '删除失败');
      }
    } catch {
      toast.error('网络错误');
    }
  };

  const openEditDialog = (user: User) => {
    setSelectedUser(user);
    setFormData({
      email: user.email,
      password: '',
      display_name: user.display_name || '',
      role: user.role,
    });
    setEditDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">用户管理</h1>
        <Button onClick={() => setCreateDialogOpen(true)}>新建用户</Button>
      </div>

      {/* 搜索和过滤 */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Input
                placeholder="搜索邮箱或昵称..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="全部状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">全部状态</SelectItem>
                <SelectItem value="active">活跃</SelectItem>
                <SelectItem value="suspended">已停用</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={handleSearch}>
              搜索
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 用户列表 */}
      <Card>
        <CardHeader>
          <CardTitle>用户列表 ({meta.total})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">加载中...</div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">暂无用户</div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-6 gap-4 py-2 px-4 bg-muted rounded-lg font-medium text-sm">
                <span>邮箱</span>
                <span>昵称</span>
                <span>角色</span>
                <span>状态</span>
                <span>最后登录</span>
                <span>操作</span>
              </div>
              {users.map((user) => (
                <div
                  key={user.id}
                  className="grid grid-cols-6 gap-4 py-3 px-4 border rounded-lg items-center"
                >
                  <span className="truncate">{user.email}</span>
                  <span className="truncate text-muted-foreground">
                    {user.display_name || '-'}
                  </span>
                  <span>
                    <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                      {user.role === 'admin' ? '管理员' : '用户'}
                    </Badge>
                  </span>
                  <span>
                    <Badge variant={user.status === 'active' ? 'default' : 'destructive'}>
                      {user.status === 'active' ? '活跃' : '已停用'}
                    </Badge>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {user.last_login_at
                      ? new Date(user.last_login_at).toLocaleString('zh-CN')
                      : '从未登录'}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditDialog(user)}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleStatus(user)}
                    >
                      {user.status === 'active' ? '停用' : '启用'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => handleDelete(user)}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 分页 */}
          {meta.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={meta.page <= 1}
                onClick={() => setMeta((prev) => ({ ...prev, page: prev.page - 1 }))}
              >
                上一页
              </Button>
              <span className="text-sm text-muted-foreground">
                {meta.page} / {meta.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={meta.page >= meta.totalPages}
                onClick={() => setMeta((prev) => ({ ...prev, page: prev.page + 1 }))}
              >
                下一页
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 创建用户对话框 */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建新用户</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>邮箱</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="user@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label>密码</Label>
              <Input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="至少8位"
              />
            </div>
            <div className="space-y-2">
              <Label>昵称（可选）</Label>
              <Input
                value={formData.display_name}
                onChange={(e) =>
                  setFormData({ ...formData, display_name: e.target.value })
                }
                placeholder="显示名称"
              />
            </div>
            <div className="space-y-2">
              <Label>角色</Label>
              <Select
                value={formData.role}
                onValueChange={(v) => setFormData({ ...formData, role: v as 'admin' | 'user' })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">普通用户</SelectItem>
                  <SelectItem value="admin">管理员</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑用户对话框 */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑用户</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>邮箱</Label>
              <Input value={formData.email} disabled />
            </div>
            <div className="space-y-2">
              <Label>昵称</Label>
              <Input
                value={formData.display_name}
                onChange={(e) =>
                  setFormData({ ...formData, display_name: e.target.value })
                }
                placeholder="显示名称"
              />
            </div>
            <div className="space-y-2">
              <Label>角色</Label>
              <Select
                value={formData.role}
                onValueChange={(v) => setFormData({ ...formData, role: v as 'admin' | 'user' })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">普通用户</SelectItem>
                  <SelectItem value="admin">管理员</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleUpdate}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
