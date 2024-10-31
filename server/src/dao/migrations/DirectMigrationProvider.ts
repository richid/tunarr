import { CompiledQuery, Migration, MigrationProvider } from 'kysely';
import { mapValues } from 'lodash-es';
import LegacyMigration0 from './db/LegacyMigration0.ts';
import LegacyMigration1 from './db/LegacyMigration1.ts';
import LegacyMigration10 from './db/LegacyMigration10.ts';
import LegacyMigration11 from './db/LegacyMigration11.ts';
import LegacyMigration12 from './db/LegacyMigration12.ts';
import LegacyMigration13 from './db/LegacyMigration13.ts';
import LegacyMigration14 from './db/LegacyMigration14.ts';
import LegacyMigration15 from './db/LegacyMigration15.ts';
import LegacyMigration2 from './db/LegacyMigration2.ts';
import LegacyMigration3 from './db/LegacyMigration3.ts';
import LegacyMigration4 from './db/LegacyMigration4.ts';
import LegacyMigration5 from './db/LegacyMigration5.ts';
import LegacyMigration6 from './db/LegacyMigration6.ts';
import LegacyMigration7 from './db/LegacyMigration7.ts';
import LegacyMigration8 from './db/LegacyMigration8.ts';
import LegacyMigration9 from './db/LegacyMigration9.ts';
import LegacyMigration16 from './db/Migration20241014205231.ts';

export const LegacyMigrationNameToNewMigrationName = [
  ['Migration20240124115044', '_Legacy_Migration00'],
  ['Migration20240126165808', '_Legacy_Migration01'],
  ['Migration20240221201014', '_Legacy_Migration02'],
  ['Migration20240308184352', '_Legacy_Migration03'],
  ['Migration20240319192121', '_Legacy_Migration04'],
  ['Migration20240404182303', '_Legacy_Migration05'],
  ['Migration20240411104034', '_Legacy_Migration06'],
  ['Migration20240416113447', '_Legacy_Migration07'],
  // I dont know why this is duped, but it is...
  // this is not a bug!
  ['Migration20240422195031', '_Legacy_Migration08'],
  ['Migration20240423195250', '_Legacy_Migration08_dupe'],
  ['Migration20240531155641', '_Legacy_Migration09'],
  // Started using names here
  ['Add new external ID types to program_external_id', '_Legacy_Migration10'],
  ['Program External ID partial indexes', '_Legacy_Migration11'],
  ['Force regenerate program_external_id table', '_Legacy_Migration12'],
  ['rename_plex_server_settings_table', '_Legacy_Migration13'],
  ['add_jellyfin_sources', '_Legacy_Migration14'],
  ['add_channel_stream_mode', '_Legacy_Migration15'],
  ['cascade_channel_filler_show_deletes', '_Legacy_Migration16'],
] as const;

export class DirectMigrationProvider implements MigrationProvider {
  // Kysely migrations are strictly run in alphanumeric asc order
  // We need to ensure migrations pre-kyesely (from mikro-orm)
  // are run FIRST and in the correct order, in order to have a smooth
  // transition away. Legacy migrations are thus prefixed with '_'
  // to ensure they are always run first
  getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve(
      mapValues(
        {
          _ALWAYS_FIRST: {
            async up(db) {
              await db.executeQuery(CompiledQuery.raw('select 1;'));
            },
          } satisfies Migration,
          _Legacy_Migration00: LegacyMigration0,
          _Legacy_Migration01: LegacyMigration1,
          _Legacy_Migration02: LegacyMigration2,
          _Legacy_Migration03: LegacyMigration3,
          _Legacy_Migration04: LegacyMigration4,
          _Legacy_Migration05: LegacyMigration5,
          _Legacy_Migration06: LegacyMigration6,
          _Legacy_Migration07: LegacyMigration7,
          _Legacy_Migration08: LegacyMigration8,
          _Legacy_Migration08_dupe: {
            async up() {
              // NO-OP
            },
          },
          _Legacy_Migration09: LegacyMigration9,
          _Legacy_Migration10: LegacyMigration10,
          _Legacy_Migration11: LegacyMigration11,
          _Legacy_Migration12: LegacyMigration12,
          _Legacy_Migration13: LegacyMigration13,
          _Legacy_Migration14: LegacyMigration14,
          _Legacy_Migration15: LegacyMigration15,
          _Legacy_Migration16: LegacyMigration16,
        },
        wrapWithTransaction,
      ),
    );
  }
}

function wrapWithTransaction(m: Migration): Migration {
  return {
    up(db) {
      return db.transaction().execute((tx) => {
        return m.up(tx);
      });
    },
    down(db) {
      return db.transaction().execute((tx) => {
        return m.down?.(tx) ?? Promise.resolve(void 0);
      });
    },
  } satisfies Migration;
}
