import type { CachedImageTable } from './CachedImage';
import type {
  ChannelCustomShowsTable,
  ChannelFallbackTable,
  ChannelFillerShowTable,
  ChannelProgramsTable,
  ChannelTable,
} from './Channel';
import type { CustomShowContentTable, CustomShowTable } from './CustomShow';
import type { FillerShowContentTable, FillerShowTable } from './FillerShow';
import type { MediaSourceTable } from './MediaSource';
import { type ProgramTable } from './Program';
import type { ProgramExternalIdTable } from './ProgramExternalId';
import type { ProgramGroupingTable } from './ProgramGrouping';
import type { ProgramGroupingExternalIdTable } from './ProgramGroupingExternalId';

export type * from './CachedImage';
export type * from './Channel';
export type * from './FillerShow';
export type * from './MediaSource';
export type * from './Program';
export type * from './ProgramExternalId';
export type * from './ProgramGrouping';
export type * from './ProgramGroupingExternalId';

export interface DB {
  cachedImage: CachedImageTable;
  channel: ChannelTable;
  channelPrograms: ChannelProgramsTable;
  channelFallback: ChannelFallbackTable;
  channelCustomShows: ChannelCustomShowsTable;
  channelFillerShow: ChannelFillerShowTable;
  customShow: CustomShowTable;
  customShowContent: CustomShowContentTable;
  fillerShow: FillerShowTable;
  fillerShowContent: FillerShowContentTable;
  mediaSource: MediaSourceTable;
  program: ProgramTable;
  programExternalId: ProgramExternalIdTable;
  programGrouping: ProgramGroupingTable;
  programGroupingExternalId: ProgramGroupingExternalIdTable;
}
