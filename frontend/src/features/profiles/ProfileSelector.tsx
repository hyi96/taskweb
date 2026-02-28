import { useProfileContext } from "./ProfileContext";

type ProfileSelectorProps = {
  compact?: boolean;
};

export function ProfileSelector({ compact = false }: ProfileSelectorProps) {
  const { profileId, setProfileId, profiles, activeProfile, isProfilesLoading } = useProfileContext();

  return (
    <div className={compact ? "profile-selector profile-selector-inline" : "profile-selector"}>
      {compact ? (
        <div className="profile-selector-inline-row">
          <small className="profile-selector-compact-label">Active Profile</small>
          <select
            id="profile-id"
            name="profile-id"
            aria-label="Active Profile"
            value={profileId}
            onChange={(event) => setProfileId(event.target.value)}
          >
            <option value="">Select profile...</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <>
          <label htmlFor="profile-id">Active Profile</label>
          <select
            id="profile-id"
            name="profile-id"
            value={profileId}
            onChange={(event) => setProfileId(event.target.value)}
          >
            <option value="">Select profile...</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </>
      )}
      {activeProfile && <small>Balance: {activeProfile.gold_balance}</small>}
      {isProfilesLoading && <small>Loading profiles...</small>}
    </div>
  );
}
