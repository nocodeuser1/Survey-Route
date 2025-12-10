import { useState, useEffect, useRef } from 'react';
import { Users, Plus, Edit2, Trash2, Check, X } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import { supabase, TeamMember } from '../lib/supabase';

interface TeamMembersManagerProps {
  accountId: string;
  authUserId: string;
}

export default function TeamMembersManager({ accountId, authUserId }: TeamMembersManagerProps) {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newMember, setNewMember] = useState({ name: '', title: '' });
  const [editMember, setEditMember] = useState({ name: '', title: '' });
  const signatureRef = useRef<SignatureCanvas>(null);

  useEffect(() => {
    loadTeamMembers();
  }, [accountId]);

  const loadTeamMembers = async () => {
    try {
      const { data, error } = await supabase
        .from('team_members')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setTeamMembers(data || []);
    } catch (err) {
      console.error('Error loading team members:', err);
    }
  };

  const handleAdd = async () => {
    if (!newMember.name.trim() || !signatureRef.current || signatureRef.current.isEmpty()) {
      alert('Please provide a name and signature');
      return;
    }

    try {
      const signatureData = signatureRef.current.toDataURL();

      const { error } = await supabase
        .from('team_members')
        .insert({
          user_id: authUserId,
          account_id: accountId,
          name: newMember.name.trim(),
          title: newMember.title.trim() || null,
          signature_data: signatureData,
        });

      if (error) throw error;

      setNewMember({ name: '', title: '' });
      signatureRef.current.clear();
      setIsAdding(false);
      loadTeamMembers();
    } catch (err) {
      console.error('Error adding team member:', err);
      alert('Failed to add team member');
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editMember.name.trim()) {
      alert('Please provide a name');
      return;
    }

    try {
      const updateData: any = {
        name: editMember.name.trim(),
        title: editMember.title.trim() || null,
        updated_at: new Date().toISOString(),
      };

      if (signatureRef.current && !signatureRef.current.isEmpty()) {
        updateData.signature_data = signatureRef.current.toDataURL();
      }

      const { error } = await supabase
        .from('team_members')
        .update(updateData)
        .eq('id', id)
        .eq('account_id', accountId);

      if (error) throw error;

      setEditingId(null);
      setEditMember({ name: '', title: '' });
      if (signatureRef.current) {
        signatureRef.current.clear();
      }
      loadTeamMembers();
    } catch (err) {
      console.error('Error updating team member:', err);
      alert('Failed to update team member');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this team member?')) return;

    try {
      const { error } = await supabase
        .from('team_members')
        .delete()
        .eq('id', id)
        .eq('account_id', accountId);

      if (error) throw error;
      loadTeamMembers();
    } catch (err) {
      console.error('Error deleting team member:', err);
      alert('Failed to delete team member');
    }
  };

  const startEdit = (member: TeamMember) => {
    setEditingId(member.id);
    setEditMember({ name: member.name, title: member.title || '' });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditMember({ name: '', title: '' });
    if (signatureRef.current) {
      signatureRef.current.clear();
    }
  };

  const cancelAdd = () => {
    setIsAdding(false);
    setNewMember({ name: '', title: '' });
    if (signatureRef.current) {
      signatureRef.current.clear();
    }
  };

  return (
    <div className="border-t pt-6">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 flex items-center gap-2">
          <Users className="w-4 h-4" />
          Team Members / Inspectors
        </h4>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Member
          </button>
        )}
      </div>

      {isAdding && (
        <div className="mb-4 p-4 border border-blue-300 rounded-lg bg-blue-50">
          <h5 className="font-medium text-sm mb-3">Add New Team Member</h5>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-1">
                Name *
              </label>
              <input
                type="text"
                value={newMember.name}
                onChange={(e) => setNewMember({ ...newMember, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="John Doe"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-1">
                Title (Optional)
              </label>
              <input
                type="text"
                value={newMember.title}
                onChange={(e) => setNewMember({ ...newMember, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="Safety Inspector"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-1">
                Signature *
              </label>
              <div className="border border-gray-300 rounded-md bg-white">
                <SignatureCanvas
                  ref={signatureRef}
                  canvasProps={{
                    className: 'w-full h-32',
                  }}
                />
              </div>
              <button
                onClick={() => signatureRef.current?.clear()}
                className="mt-1 text-xs text-gray-600 hover:text-gray-900 dark:text-white"
              >
                Clear Signature
              </button>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={cancelAdd}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700"
              >
                Save Member
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {teamMembers.map((member) => (
          <div key={member.id} className="p-3 border border-gray-200 rounded-lg">
            {editingId === member.id ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-1">
                    Name *
                  </label>
                  <input
                    type="text"
                    value={editMember.name}
                    onChange={(e) => setEditMember({ ...editMember, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-1">
                    Title (Optional)
                  </label>
                  <input
                    type="text"
                    value={editMember.title}
                    onChange={(e) => setEditMember({ ...editMember, title: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-1">
                    New Signature (Optional - leave blank to keep existing)
                  </label>
                  <div className="border border-gray-300 rounded-md bg-white">
                    <SignatureCanvas
                      ref={signatureRef}
                      canvasProps={{
                        className: 'w-full h-32',
                      }}
                    />
                  </div>
                  <button
                    onClick={() => signatureRef.current?.clear()}
                    className="mt-1 text-xs text-gray-600 hover:text-gray-900 dark:text-white"
                  >
                    Clear Signature
                  </button>
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={cancelEdit}
                    className="p-1.5 text-gray-600 hover:bg-gray-100 rounded"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleUpdate(member.id)}
                    className="p-1.5 text-green-600 hover:bg-green-50 rounded"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h5 className="font-medium text-sm">{member.name}</h5>
                  {member.title && (
                    <p className="text-xs text-gray-600">{member.title}</p>
                  )}
                  <div className="mt-2">
                    <img
                      src={member.signature_data}
                      alt={`${member.name}'s signature`}
                      className="h-12 border border-gray-200 rounded"
                    />
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => startEdit(member)}
                    className="p-1.5 text-gray-600 hover:bg-gray-100 rounded"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(member.id)}
                    className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {teamMembers.length === 0 && !isAdding && (
          <p className="text-sm text-gray-500 text-center py-4">
            No team members added yet
          </p>
        )}
      </div>
    </div>
  );
}
