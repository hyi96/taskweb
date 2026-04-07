from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0002_inspirationalphrase"),
    ]

    operations = [
        migrations.AddField(
            model_name="profile",
            name="is_vacation_mode",
            field=models.BooleanField(default=False),
        ),
    ]
