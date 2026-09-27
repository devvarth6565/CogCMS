import mongoose, { Document, Model, Schema, Types } from 'mongoose';
import type { RenderedBlogSnapshot } from '@/lib/render/blog';

export type PublicationStatus = 'draft' | 'publish';

export interface IBlog extends Document<Types.ObjectId> {
  siteId: Types.ObjectId;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  imageUrl: string;
  tag?: string;
  authorId: Types.ObjectId | null;
  category?: string;
  tags: string[];
  faqs: { question: string; answer: string }[];
  keyTakeaways: string[];
  relatedSlugs: string[];
  tocOverrides: { id: string; label?: string; hidden?: boolean }[];
  status: PublicationStatus;
  publishedAt: Date | null;
  metaTitle?: string;
  metaDescription?: string;
  keywords?: string;
  isFeatured: boolean;
  rendered: RenderedBlogSnapshot;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const TocEntrySchema = new Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true },
    level: { type: Number, required: true },
  },
  { _id: false },
);

const RenderedBlogSchema = new Schema(
  {
    // A legacy or newly sanitized placeholder can validly render to an empty string.
    html: { type: String, default: '' },
    toc: { type: [TocEntrySchema], default: [] },
    wordCount: { type: Number, required: true, min: 0 },
    readingTime: { type: Number, required: true, min: 0 },
    pipelineVersion: { type: Number, required: true, min: 1 },
    renderedAt: { type: Date, required: true },
  },
  { _id: false },
);

const BlogSchema = new Schema<IBlog>(
  {
    siteId: { type: Schema.Types.ObjectId, ref: 'Site', required: true, index: true },
    title: { type: String, required: true },
    slug: { type: String, required: true },
    excerpt: { type: String, default: '' },
    content: { type: String, required: true },
    imageUrl: { type: String, default: '' },
    tag: { type: String, default: 'Insights' },
    authorId: { type: Schema.Types.ObjectId, ref: 'Author', default: null },
    category: { type: String, default: '' },
    tags: { type: [String], default: [] },
    faqs: {
      type: [{ question: { type: String }, answer: { type: String } }],
      default: [],
    },
    keyTakeaways: { type: [String], default: [] },
    relatedSlugs: { type: [String], default: [] },
    tocOverrides: {
      type: [{ id: { type: String }, label: { type: String }, hidden: { type: Boolean } }],
      default: [],
    },
    status: { type: String, enum: ['draft', 'publish'], default: 'publish' },
    publishedAt: { type: Date, default: null },
    metaTitle: { type: String, default: '' },
    metaDescription: { type: String, default: '' },
    keywords: { type: String, default: '' },
    isFeatured: { type: Boolean, default: false },
    rendered: { type: RenderedBlogSchema, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, collection: 'blogs' },
);

BlogSchema.pre('validate', function setFirstPublishedAt() {
  if (this.status === 'publish' && !this.publishedAt) this.publishedAt = new Date();
});
BlogSchema.index({ siteId: 1, slug: 1 }, { unique: true });
BlogSchema.index({ siteId: 1, status: 1, createdAt: -1 });
// Serves the admin list's default "all statuses" order without an in-memory sort.
BlogSchema.index({ siteId: 1, createdAt: -1, _id: -1 });

const Blog: Model<IBlog> = mongoose.models.Blog || mongoose.model<IBlog>('Blog', BlogSchema);

export default Blog;
