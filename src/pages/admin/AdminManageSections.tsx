import React, { useEffect, useState } from 'react';
import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { CheckCircle2, AlertCircle, Download, Loader2, Trash2 } from 'lucide-react';
import { useApp } from '../../contexts/AppContext';
import { OperationType, db, handleFirestoreError, storage } from '../../lib/firebase';
import { testCloudinaryConnection } from '../../lib/upload';
import { AdminFileUploader } from '../../components/admin/AdminFileUploader';
import { SOCIAL_PLATFORM_FIELDS } from '../../lib/social';
import {
  AchievementItem,
  ContactMessage,
  ExperienceItem,
  MessageStatus,
  SKILL_CATEGORIES,
  ServiceItem,
  SiteSettings,
  SkillCategory,
  SkillItem,
} from '../../types';
import { ConfirmDialog } from './AdminLayout';

export function AdminSkillsSection() {
  const { skills, pushToast } = useApp();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<SkillCategory>('Frontend Development');
  const [description, setDescription] = useState('');
  const [proficiency, setProficiency] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SkillItem | null>(null);

  const reset = () => {
    setEditingId(null);
    setName('');
    setCategory('Frontend Development');
    setDescription('');
    setProficiency('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = editingId || `skill-${Date.now()}`;
    try {
      if (editingId) {
        await updateDoc(doc(db, 'skills', editingId), {
          name: name.trim(),
          category,
          description: description.trim(),
          proficiency: proficiency.trim(),
          updatedAt: serverTimestamp(),
        });
        pushToast('success', 'Skill updated.');
      } else {
        await setDoc(doc(db, 'skills', id), {
          name: name.trim(),
          category,
          description: description.trim(),
          proficiency: proficiency.trim(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        pushToast('success', 'Skill added.');
      }
      reset();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `skills/${id}`);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'skills', deleteTarget.id));
      pushToast('info', 'Skill removed.');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `skills/${deleteTarget.id}`);
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#1B4332] dark:text-[#F4F1EA]">
        Skills &amp; Technologies
      </h1>
      <form
        onSubmit={handleSave}
        className="p-6 rounded-xl border border-[#DFD5C3] dark:border-[#24352C] bg-white dark:bg-[#141F1A] space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <input
            type="text"
            required
            placeholder="Skill name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as SkillCategory)}
            className="px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
          >
            {SKILL_CATEGORIES.map((c) => (
              <option key={c} value={c} className="dark:bg-[#141F1A]">
                {c}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Optional proficiency note"
            value={proficiency}
            onChange={(e) => setProficiency(e.target.value)}
            className="px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
          />
        </div>
        <input
          type="text"
          placeholder="Short description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
        />
        <div className="flex gap-3">
          <button
            type="submit"
            className="px-5 py-2 text-xs font-medium bg-[#1B4332] dark:bg-[#52A58C] text-[#FAF8F3] dark:text-[#0D1411] rounded-md cursor-pointer"
          >
            {editingId ? 'Update Skill' : 'Add Skill'}
          </button>
          {editingId && (
            <button type="button" onClick={reset} className="text-xs underline cursor-pointer">
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="divide-y divide-[#DFD5C3] dark:divide-[#24352C] border border-[#DFD5C3] dark:border-[#24352C] rounded-xl bg-white dark:bg-[#141F1A]">
        {skills.map((s) => (
          <div key={s.id} className="p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold">
                {s.name} {s.proficiency ? `· ${s.proficiency}` : ''}
              </p>
              <p className="text-xs text-[#5B6B63]">
                {s.category} — {s.description}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingId(s.id);
                  setName(s.name);
                  setCategory(s.category);
                  setDescription(s.description);
                  setProficiency(s.proficiency || '');
                }}
                className="px-3 py-1 text-xs border border-[#DFD5C3] dark:border-[#24352C] rounded cursor-pointer"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(s)}
                className="p-1.5 text-red-600 cursor-pointer"
                aria-label={`Delete ${s.name}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Skill"
        message={`Remove "${deleteTarget?.name}" from skills?`}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export function AdminExperienceSection() {
  const { experience, pushToast } = useApp();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [organization, setOrganization] = useState('');
  const [kind, setKind] = useState<'experience' | 'education'>('experience');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isCurrent, setIsCurrent] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ExperienceItem | null>(null);

  const reset = () => {
    setEditingId(null);
    setTitle('');
    setOrganization('');
    setKind('experience');
    setDescription('');
    setStartDate('');
    setEndDate('');
    setIsCurrent(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = editingId || `exp-${Date.now()}`;
    try {
      const data = {
        title: title.trim(),
        organization: organization.trim(),
        kind,
        description: description.trim(),
        startDate: startDate.trim(),
        endDate: isCurrent ? '' : endDate.trim(),
        isCurrent,
        updatedAt: serverTimestamp(),
      };
      if (editingId) {
        await updateDoc(doc(db, 'experience', editingId), data);
        pushToast('success', 'Record updated.');
      } else {
        await setDoc(doc(db, 'experience', id), {
          ...data,
          createdAt: serverTimestamp(),
        });
        pushToast('success', 'Record added.');
      }
      reset();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `experience/${id}`);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'experience', deleteTarget.id));
      pushToast('info', 'Record deleted.');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `experience/${deleteTarget.id}`);
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#1B4332] dark:text-[#F4F1EA]">
        Experience &amp; Education
      </h1>
      <form
        onSubmit={handleSave}
        className="p-6 rounded-xl border border-[#DFD5C3] dark:border-[#24352C] bg-white dark:bg-[#141F1A] space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <input
            type="text"
            required
            placeholder="Role or Degree Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
          />
          <input
            type="text"
            required
            placeholder="Organization or Institution"
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            className="px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'experience' | 'education')}
            className="px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
          >
            <option value="experience" className="dark:bg-[#141F1A]">Experience</option>
            <option value="education" className="dark:bg-[#141F1A]">Education</option>
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
          <input
            type="text"
            required
            placeholder="Start Date (e.g. 2024)"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
          />
          <input
            type="text"
            disabled={isCurrent}
            placeholder="End Date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md disabled:opacity-40"
          />
          <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={isCurrent}
              onChange={(e) => setIsCurrent(e.target.checked)}
              className="accent-[#1B4332]"
            />
            <span>Current Position / Ongoing</span>
          </label>
        </div>
        <textarea
          rows={2}
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
        />
        <div className="flex gap-3">
          <button
            type="submit"
            className="px-5 py-2 text-xs font-medium bg-[#1B4332] dark:bg-[#52A58C] text-[#FAF8F3] dark:text-[#0D1411] rounded-md cursor-pointer"
          >
            {editingId ? 'Update Record' : 'Add Record'}
          </button>
          {editingId && (
            <button type="button" onClick={reset} className="text-xs underline cursor-pointer">
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="space-y-3">
        {experience.map((item) => (
          <div
            key={item.id}
            className="p-4 rounded-xl border border-[#DFD5C3] dark:border-[#24352C] bg-white dark:bg-[#141F1A] flex items-center justify-between gap-4"
          >
            <div>
              <p className="text-xs text-[#5B6B63] capitalize">
                {item.kind} · {item.startDate} — {item.isCurrent ? 'Present' : item.endDate}
              </p>
              <p className="text-sm font-semibold">
                {item.title} · {item.organization}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingId(item.id);
                  setTitle(item.title);
                  setOrganization(item.organization);
                  setKind(item.kind);
                  setDescription(item.description);
                  setStartDate(item.startDate);
                  setEndDate(item.endDate || '');
                  setIsCurrent(item.isCurrent);
                }}
                className="px-3 py-1 text-xs border border-[#DFD5C3] dark:border-[#24352C] rounded cursor-pointer"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(item)}
                className="p-1.5 text-red-600 cursor-pointer"
                aria-label={`Delete ${item.title}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Entry"
        message={`Delete "${deleteTarget?.title}"?`}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export function AdminServicesSection() {
  const { services, settings, pushToast } = useApp();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [featuresText, setFeaturesText] = useState('');
  const [startingPrice, setStartingPrice] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [published, setPublished] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<ServiceItem | null>(null);

  const reset = () => {
    setEditingId(null);
    setTitle('');
    setDescription('');
    setFeaturesText('');
    setStartingPrice('');
    setImageUrl('');
    setPublished(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = editingId || `svc-${Date.now()}`;
    const features = featuresText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);

    try {
      const data = {
        title: title.trim(),
        description: description.trim(),
        features,
        startingPrice: startingPrice.trim(),
        imageUrl: imageUrl.trim(),
        published,
        updatedAt: serverTimestamp(),
      };
      if (editingId) {
        await updateDoc(doc(db, 'services', editingId), data);
        pushToast('success', 'Service updated.');
      } else {
        await setDoc(doc(db, 'services', id), {
          ...data,
          createdAt: serverTimestamp(),
        });
        pushToast('success', 'Service added.');
      }
      reset();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `services/${id}`);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'services', deleteTarget.id));
      pushToast('info', 'Service deleted.');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `services/${deleteTarget.id}`);
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#1B4332] dark:text-[#F4F1EA]">
        Services Management
      </h1>

      <form
        onSubmit={handleSave}
        className="p-6 rounded-xl border border-[#DFD5C3] dark:border-[#24352C] bg-white dark:bg-[#141F1A] space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <input
            type="text"
            required
            placeholder="Service Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
          />
          <input
            type="text"
            placeholder="Optional Starting Price (leave blank to hide)"
            value={startingPrice}
            onChange={(e) => setStartingPrice(e.target.value)}
            className="px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
          />
        </div>
        <textarea
          rows={2}
          required
          placeholder="Service description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
        />
        <textarea
          rows={3}
          placeholder="Features (one per line)"
          value={featuresText}
          onChange={(e) => setFeaturesText(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
        />
        <AdminFileUploader
          label="Service Visual (Optional)"
          accept="image/png,image/jpeg,image/webp,image/gif"
          kind="service"
          value={imageUrl}
          onChange={setImageUrl}
          placeholder="Or paste hosted image URL"
          buttonLabel="Upload Service Image"
          showPreview
          previewClassName="h-24 rounded-md border border-[#DFD5C3] dark:border-[#24352C] object-cover"
          cloudName={settings.cloudinaryCloudName}
          uploadPreset={settings.cloudinaryUploadPreset}
          onSuccessToast={(msg) => pushToast('success', msg)}
          onErrorToast={(msg) => pushToast('error', msg)}
        />
        <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
            className="accent-[#1B4332]"
          />
          <span>Published</span>
        </label>
        <div className="flex gap-3">
          <button
            type="submit"
            className="px-5 py-2 text-xs font-medium bg-[#1B4332] dark:bg-[#52A58C] text-[#FAF8F3] dark:text-[#0D1411] rounded-md cursor-pointer"
          >
            {editingId ? 'Update Service' : 'Save Service'}
          </button>
          {editingId && (
            <button type="button" onClick={reset} className="text-xs underline cursor-pointer">
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="space-y-3">
        {services.map((svc) => (
          <div
            key={svc.id}
            className="p-4 rounded-xl border border-[#DFD5C3] dark:border-[#24352C] bg-white dark:bg-[#141F1A] flex items-center justify-between gap-4"
          >
            <div>
              <p className="text-sm font-semibold">{svc.title}</p>
              <p className="text-xs text-[#5B6B63]">
                {svc.startingPrice ? `From ${svc.startingPrice}` : 'Price hidden'} ·{' '}
                {svc.published ? 'Published' : 'Hidden'}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingId(svc.id);
                  setTitle(svc.title);
                  setDescription(svc.description);
                  setFeaturesText(svc.features.join('\n'));
                  setStartingPrice(svc.startingPrice || '');
                  setImageUrl(svc.imageUrl || '');
                  setPublished(svc.published);
                }}
                className="px-3 py-1 text-xs border border-[#DFD5C3] dark:border-[#24352C] rounded cursor-pointer"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(svc)}
                className="p-1.5 text-red-600 cursor-pointer"
                aria-label={`Delete ${svc.title}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Service"
        message={`Delete "${deleteTarget?.title}"?`}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export function AdminMessagesSection() {
  const { messages, pushToast } = useApp();
  const [filter, setFilter] = useState<'all' | MessageStatus>('all');
  const [deleteTarget, setDeleteTarget] = useState<ContactMessage | null>(null);

  const visible = messages.filter((m) => (filter === 'all' ? true : m.status === filter));

  const updateStatus = async (id: string, status: MessageStatus) => {
    try {
      await updateDoc(doc(db, 'messages', id), { status });
      pushToast('info', `Message marked ${status}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `messages/${id}`);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'messages', deleteTarget.id));
      pushToast('info', 'Message deleted.');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `messages/${deleteTarget.id}`);
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#1B4332] dark:text-[#F4F1EA]">
          Client Messages
        </h1>
        <div className="flex gap-1 p-1 bg-[#F2EFE7] dark:bg-[#141F1A] rounded-lg">
          {(['all', 'unread', 'read', 'archived'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setFilter(st)}
              className={`px-3 py-1.5 text-xs font-medium capitalize rounded-md cursor-pointer ${
                filter === st
                  ? 'bg-white dark:bg-[#1E3128] text-[#1B4332] dark:text-[#F4F1EA] shadow-sm'
                  : 'text-[#5B6B63]'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="p-10 rounded-xl border border-[#DFD5C3] dark:border-[#24352C] bg-white dark:bg-[#141F1A] text-center text-sm text-[#5B6B63]">
          No messages in this view.
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((msg) => (
            <article
              key={msg.id}
              className="p-6 rounded-xl border border-[#DFD5C3] dark:border-[#24352C] bg-white dark:bg-[#141F1A] space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-[#F2EFE7] dark:border-[#24352C]">
                <div>
                  <h2 className="text-base font-semibold">
                    {msg.fullName} ·{' '}
                    <span className="font-normal text-xs text-[#5B6B63]">{msg.email}</span>
                  </h2>
                  <p className="text-xs text-[#5B6B63] mt-0.5">
                    {msg.projectType}
                    {msg.budgetRange ? ` · Budget: ${msg.budgetRange}` : ''}
                    {msg.whatsapp ? ` · WhatsApp: ${msg.whatsapp}` : ''}
                  </p>
                </div>
                <span className="text-xs font-medium capitalize text-[#2D6A6A] dark:text-[#6EC4A7]">
                  {msg.status}
                </span>
              </div>

              <p className="text-sm leading-relaxed text-[#3F4E47] dark:text-[#C5D1CB] whitespace-pre-line">
                {msg.description}
              </p>

              <div className="flex flex-wrap items-center gap-2 pt-2">
                {msg.status !== 'read' && (
                  <button
                    type="button"
                    onClick={() => void updateStatus(msg.id, 'read')}
                    className="px-3 py-1.5 text-xs font-medium border border-[#DFD5C3] dark:border-[#24352C] rounded cursor-pointer"
                  >
                    Mark Read
                  </button>
                )}
                {msg.status !== 'unread' && (
                  <button
                    type="button"
                    onClick={() => void updateStatus(msg.id, 'unread')}
                    className="px-3 py-1.5 text-xs font-medium border border-[#DFD5C3] dark:border-[#24352C] rounded cursor-pointer"
                  >
                    Mark Unread
                  </button>
                )}
                {msg.status !== 'archived' && (
                  <button
                    type="button"
                    onClick={() => void updateStatus(msg.id, 'archived')}
                    className="px-3 py-1.5 text-xs font-medium border border-[#DFD5C3] dark:border-[#24352C] rounded cursor-pointer"
                  >
                    Archive
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDeleteTarget(msg)}
                  className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Message"
        message={`Delete message from "${deleteTarget?.fullName}" permanently?`}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export function AdminAchievementsSection() {
  const { achievements, settings, pushToast } = useApp();
  const [title, setTitle] = useState('');
  const [issuer, setIssuer] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [description, setDescription] = useState('');
  const [certificateUrl, setCertificateUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [published, setPublished] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<AchievementItem | null>(null);

  const [cvUrl, setCvUrl] = useState(settings.cvUrl || '');
  const [cvFileName, setCvFileName] = useState(settings.cvFileName || '');
  const [cvPublic, setCvPublic] = useState(settings.cvPublic);

  useEffect(() => {
    setCvUrl(settings.cvUrl || '');
    setCvFileName(settings.cvFileName || '');
    setCvPublic(settings.cvPublic);
  }, [settings]);

  const handleSaveCv = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await setDoc(doc(db, 'site_settings', 'main'), {
        ...settings,
        cvUrl: cvUrl.trim(),
        cvFileName: cvFileName.trim(),
        cvPublic,
        updatedAt: serverTimestamp(),
      });
      pushToast('success', 'CV / Resume settings saved.');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'site_settings/main');
    }
  };

  const handleAddAchievement = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = `ach-${Date.now()}`;
    try {
      await setDoc(doc(db, 'achievements', id), {
        title: title.trim(),
        issuer: issuer.trim(),
        issueDate: issueDate.trim(),
        description: description.trim(),
        certificateUrl: certificateUrl.trim(),
        imageUrl: imageUrl.trim(),
        published,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setTitle('');
      setIssuer('');
      setIssueDate('');
      setDescription('');
      setCertificateUrl('');
      setImageUrl('');
      pushToast('success', 'Achievement saved.');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `achievements/${id}`);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'achievements', deleteTarget.id));
      pushToast('info', 'Achievement deleted.');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `achievements/${deleteTarget.id}`);
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#1B4332] dark:text-[#F4F1EA]">
        Achievements, Certificates &amp; CV
      </h1>

      {/* CV / Resume Uploader */}
      <form
        onSubmit={handleSaveCv}
        className="p-6 rounded-xl border border-[#DFD5C3] dark:border-[#24352C] bg-white dark:bg-[#141F1A] space-y-4"
      >
        <h2 className="font-display text-2xl font-semibold">CV / Resume Management</h2>
        <AdminFileUploader
          label="CV / Resume PDF"
          accept="application/pdf"
          kind="document"
          value={cvUrl}
          onChange={setCvUrl}
          onFileNameChange={setCvFileName}
          placeholder="Or paste hosted CV PDF URL"
          buttonLabel="Upload CV (PDF)"
          cloudName={settings.cloudinaryCloudName}
          uploadPreset={settings.cloudinaryUploadPreset}
          onSuccessToast={(msg) =>
            pushToast('success', `${msg} Click Save CV Settings to apply.`)
          }
          onErrorToast={(msg) => pushToast('error', msg)}
        />
        <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer">
          <input
            type="checkbox"
            checked={cvPublic}
            onChange={(e) => setCvPublic(e.target.checked)}
            className="accent-[#1B4332]"
          />
          <span>Enable public Download CV button in Navigation &amp; Experience page</span>
        </label>
        <div>
          <button
            type="submit"
            className="px-5 py-2 text-xs font-medium bg-[#1B4332] dark:bg-[#52A58C] text-[#FAF8F3] dark:text-[#0D1411] rounded-md cursor-pointer"
          >
            Save CV Settings
          </button>
        </div>
      </form>

      {/* Add Achievement */}
      <form
        onSubmit={handleAddAchievement}
        className="p-6 rounded-xl border border-[#DFD5C3] dark:border-[#24352C] bg-white dark:bg-[#141F1A] space-y-4"
      >
        <h2 className="font-display text-2xl font-semibold">Add Certificate or Award</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <input
            type="text"
            required
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
          />
          <input
            type="text"
            required
            placeholder="Issuer"
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            className="px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
          />
          <input
            type="text"
            required
            placeholder="Issue Date (e.g. Oct 2025)"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            className="px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
          />
        </div>
        <textarea
          rows={2}
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
        />
        <div className="space-y-4">
          <AdminFileUploader
            label="Certificate Image (Optional)"
            accept="image/png,image/jpeg,image/webp,image/gif"
            kind="certificate"
            value={imageUrl}
            onChange={setImageUrl}
            placeholder="Or paste certificate image URL"
            buttonLabel="Upload Certificate Image"
            showPreview
            previewClassName="h-24 rounded-md border border-[#DFD5C3] dark:border-[#24352C] object-cover"
            cloudName={settings.cloudinaryCloudName}
            uploadPreset={settings.cloudinaryUploadPreset}
            onSuccessToast={(msg) => pushToast('success', msg)}
            onErrorToast={(msg) => pushToast('error', msg)}
          />
          <input
            type="url"
            placeholder="Verification URL (optional)"
            value={certificateUrl}
            onChange={(e) => setCertificateUrl(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
          />
        </div>
        <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
            className="accent-[#1B4332]"
          />
          <span>Published Publicly</span>
        </label>
        <div>
          <button
            type="submit"
            className="px-5 py-2 text-xs font-medium bg-[#1B4332] dark:bg-[#52A58C] text-[#FAF8F3] dark:text-[#0D1411] rounded-md cursor-pointer"
          >
            Save Achievement
          </button>
        </div>
      </form>

      <div className="space-y-3">
        {achievements.map((ach) => (
          <div
            key={ach.id}
            className="p-4 rounded-xl border border-[#DFD5C3] dark:border-[#24352C] bg-white dark:bg-[#141F1A] flex items-center justify-between gap-4"
          >
            <div>
              <p className="text-sm font-semibold">{ach.title}</p>
              <p className="text-xs text-[#5B6B63]">
                {ach.issuer} · {ach.issueDate}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDeleteTarget(ach)}
              className="p-1.5 text-red-600 cursor-pointer"
              aria-label={`Delete ${ach.title}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Achievement"
        message={`Delete "${deleteTarget?.title}"?`}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export function AdminSeoSection() {
  const { settings, pushToast } = useApp();
  const [seoTitle, setSeoTitle] = useState(settings.seoTitle);
  const [seoDescription, setSeoDescription] = useState(settings.seoDescription);
  const [seoShareImageUrl, setSeoShareImageUrl] = useState(
    settings.seoShareImageUrl || ''
  );

  useEffect(() => {
    setSeoTitle(settings.seoTitle);
    setSeoDescription(settings.seoDescription);
    setSeoShareImageUrl(settings.seoShareImageUrl || '');
  }, [settings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await setDoc(doc(db, 'site_settings', 'main'), {
        ...settings,
        seoTitle: seoTitle.trim(),
        seoDescription: seoDescription.trim(),
        seoShareImageUrl: seoShareImageUrl.trim(),
        updatedAt: serverTimestamp(),
      });
      pushToast('success', 'SEO settings saved.');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'site_settings/main');
    }
  };

  return (
    <form
      onSubmit={handleSave}
      className="p-6 sm:p-7 rounded-xl border border-[#DFD5C3] dark:border-[#24352C] bg-white dark:bg-[#141F1A] space-y-5"
    >
      <h1 className="font-display text-3xl font-semibold text-[#1B4332] dark:text-[#F4F1EA]">
        SEO &amp; Social Share Metadata
      </h1>
      <div className="space-y-1.5">
        <label className="block text-xs font-medium">Default Page Title</label>
        <input
          type="text"
          required
          maxLength={140}
          value={seoTitle}
          onChange={(e) => setSeoTitle(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
        />
      </div>
      <div className="space-y-1.5">
        <label className="block text-xs font-medium">Meta Description</label>
        <textarea
          rows={3}
          required
          maxLength={320}
          value={seoDescription}
          onChange={(e) => setSeoDescription(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
        />
      </div>
      <div className="space-y-1.5">
        <label className="block text-xs font-medium">Open Graph Share Image URL</label>
        <input
          type="text"
          value={seoShareImageUrl}
          onChange={(e) => setSeoShareImageUrl(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
        />
      </div>
      <button
        type="submit"
        className="px-5 py-2.5 text-sm font-medium bg-[#1B4332] dark:bg-[#52A58C] text-[#FAF8F3] dark:text-[#0D1411] rounded-md cursor-pointer"
      >
        Save SEO Settings
      </button>
    </form>
  );
}

export function AdminSettingsSection() {
  const {
    profile,
    about,
    settings,
    gallery,
    projects,
    skills,
    experience,
    achievements,
    services,
    pushToast,
  } = useApp();

  const [contactEmail, setContactEmail] = useState(settings.contactEmail);
  const [whatsappNumber, setWhatsappNumber] = useState(settings.whatsappNumber);
  const [socialUrls, setSocialUrls] = useState<Record<string, string>>({});
  const [copyrightNotice, setCopyrightNotice] = useState(settings.copyrightNotice);
  const [cloudName, setCloudName] = useState(settings.cloudinaryCloudName || 'f1gc3fzr');
  const [uploadPreset, setUploadPreset] = useState(
    settings.cloudinaryUploadPreset || 'Portfolio Website RAHI'
  );
  const [testingCloud, setTestingCloud] = useState(false);
  const [cloudTestResult, setCloudTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    setContactEmail(settings.contactEmail);
    setWhatsappNumber(settings.whatsappNumber);
    const nextSocials: Record<string, string> = {};
    for (const field of SOCIAL_PLATFORM_FIELDS) {
      const val = settings[field.key];
      nextSocials[field.key] = typeof val === 'string' ? val : '';
    }
    setSocialUrls(nextSocials);
    setCopyrightNotice(settings.copyrightNotice);
    setCloudName(settings.cloudinaryCloudName || 'f1gc3fzr');
    setUploadPreset(settings.cloudinaryUploadPreset || 'Portfolio Website RAHI');
  }, [settings]);

  const handleSocialChange = (key: keyof SiteSettings, val: string) => {
    setSocialUrls((prev) => ({ ...prev, [key]: val }));
  };

  const handleTestCloudinary = async () => {
    setTestingCloud(true);
    setCloudTestResult(null);
    const result = await testCloudinaryConnection(cloudName, uploadPreset);
    setCloudTestResult({ ok: result.ok, message: result.message });
    setTestingCloud(false);
    pushToast(result.ok ? 'success' : 'error', result.message);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const socialPayload: Record<string, string> = {};
      for (const field of SOCIAL_PLATFORM_FIELDS) {
        socialPayload[field.key] = (socialUrls[field.key] || '').trim();
      }
      await setDoc(doc(db, 'site_settings', 'main'), {
        ...settings,
        contactEmail: contactEmail.trim(),
        whatsappNumber: whatsappNumber.trim(),
        ...socialPayload,
        copyrightNotice: copyrightNotice.trim(),
        cloudinaryCloudName: cloudName.trim(),
        cloudinaryUploadPreset: uploadPreset.trim(),
        updatedAt: serverTimestamp(),
      });
      pushToast('success', 'Website & social media settings saved.');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'site_settings/main');
    }
  };

  const handleExportBackup = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      profile,
      about,
      settings,
      gallery,
      projects,
      skills,
      experience,
      achievements,
      services,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vexora-studio-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#1B4332] dark:text-[#F4F1EA]">
          Website Settings, Social Links &amp; Backup
        </h1>
        <button
          type="button"
          onClick={handleExportBackup}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium border border-[#DFD5C3] dark:border-[#24352C] rounded-md cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export JSON Backup</span>
        </button>
      </div>

      <form
        onSubmit={handleSave}
        className="p-6 sm:p-7 rounded-xl border border-[#DFD5C3] dark:border-[#24352C] bg-white dark:bg-[#141F1A] space-y-6"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium">Contact Email *</label>
            <input
              type="email"
              required
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium">
              WhatsApp Number (with country code, e.g. +8801XXXXXXXXX)
            </label>
            <input
              type="text"
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
              placeholder="+880..."
              className="w-full px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-[#F2EFE7] dark:border-[#24352C] space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-[#1B4332] dark:text-[#6EC4A7]">
              Connect Social Media Accounts
            </h2>
            <p className="text-xs text-[#5B6B63] dark:text-[#8E9F96] mt-0.5">
              Add links for any platform you want displayed in your Footer, Mobile Menu, and Contact page (leave blank to hide).
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {SOCIAL_PLATFORM_FIELDS.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <label className="block text-xs font-medium">{field.label}</label>
                <input
                  type="url"
                  value={socialUrls[field.key] || ''}
                  onChange={(e) => handleSocialChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium">Footer Copyright Notice</label>
          <input
            type="text"
            required
            value={copyrightNotice}
            onChange={(e) => setCopyrightNotice(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
          />
        </div>

        <div className="pt-4 border-t border-[#F2EFE7] dark:border-[#24352C] space-y-3">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[#1B4332] dark:text-[#6EC4A7]">
              Free $0 Media Storage — Cloudinary CDN (No Credit Card Required)
            </p>
            <p className="text-[11px] text-[#5B6B63] dark:text-[#8E9F96] leading-relaxed">
              Firebase Auth &amp; Firestore stay 100% free on Spark, while new Firebase Storage buckets require Blaze billing. Use a free Cloudinary account (25 GB free, no card needed): Upload Settings → Add Unsigned Upload Preset, then paste your Cloud Name &amp; Preset below. (Firebase Storage bucket {storage.app.options.storageBucket || 'configured'} remains an automatic fallback if enabled.)
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="Cloudinary Cloud Name"
              value={cloudName}
              onChange={(e) => {
                setCloudTestResult(null);
                setCloudName(e.target.value);
              }}
              className="px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
            />
            <input
              type="text"
              placeholder="Cloudinary Unsigned Upload Preset"
              value={uploadPreset}
              onChange={(e) => {
                setCloudTestResult(null);
                setUploadPreset(e.target.value);
              }}
              className="px-3 py-2 text-sm bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={testingCloud || !cloudName.trim() || !uploadPreset.trim()}
              onClick={() => void handleTestCloudinary()}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium border border-[#1B4332] dark:border-[#52A58C] text-[#1B4332] dark:text-[#6EC4A7] rounded-md hover:bg-[#1B4332]/5 disabled:opacity-45 cursor-pointer"
            >
              {testingCloud && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{testingCloud ? 'Testing Cloudinary...' : 'Test Cloudinary Connection'}</span>
            </button>
            {cloudTestResult && (
              <span
                className={`inline-flex items-center gap-1.5 text-xs ${
                  cloudTestResult.ok
                    ? 'text-[#1B4332] dark:text-[#6EC4A7]'
                    : 'text-red-700 dark:text-red-300'
                }`}
              >
                {cloudTestResult.ok ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>{cloudTestResult.message}</span>
              </span>
            )}
          </div>
        </div>

        <button
          type="submit"
          className="px-6 py-2.5 text-sm font-medium bg-[#1B4332] dark:bg-[#52A58C] text-[#FAF8F3] dark:text-[#0D1411] rounded-md cursor-pointer"
        >
          Save Settings
        </button>
      </form>
    </div>
  );
}
